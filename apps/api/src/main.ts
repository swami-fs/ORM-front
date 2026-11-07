#!/usr/bin/env node
// @nx-target-name: serve
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ProductsService } from '@org/api-products';
import type {
  ApiResponse,
  Product,
  ProductFilter,
  PaginatedResponse,
} from '@org/models';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
dotenv.config({ path: path.resolve(currentDirPath, '../.env') });
const workspaceRootPath = path.resolve(currentDirPath, '../../..');
const logDirPath = path.join(workspaceRootPath, 'log');
const logFilePath = path.join(logDirPath, 'orm-front-api.log');

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3333;
const execFileAsync = promisify(execFile);

const app = express();
const productsService = new ProductsService();

async function writeLog(level: 'WARNING' | 'ERROR', message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${level} ${message}\n`;
  if (level === 'ERROR') {
    console.error(message);
  } else {
    console.warn(message);
  }
  try {
    await mkdir(logDirPath, { recursive: true });
    await appendFile(logFilePath, line, 'utf8');
  } catch (logError) {
    const fallbackMessage =
      logError instanceof Error ? logError.message : 'Unknown file logging error';
    console.error(`Failed to write API log file: ${fallbackMessage}`);
  }
}

// Middleware
app.use(express.json({ limit: '4mb' }));

// CORS configuration for React app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept',
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.get('/', (req, res) => {
  res.send({ message: 'Hello API' });
});

type CurlFetchResponse = {
  sourceUrl: string;
  fetchedUrl: string;
  html: string;
};

type ReviewLensIngestSummary = {
  dataset_id: string;
  platform: string;
  entity_name: string;
  review_count: number;
  rating_count: number;
  average_rating: number | null;
  first_review_date: string | null;
  last_review_date: string | null;
};

type ReviewLensChatResponse = {
  decision: 'answer' | 'decline';
  answer: string;
  evidence_review_ids: string[];
};

type ReviewLensAuthenticateResponse = {
  bearer_token: string;
};

type ReviewLensHealthResponse = {
  status: string;
  service: string;
  version: string;
};

const amazonAsinRegex = /\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?]|$)/i;

function ensureSupportedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }
  const hostName = parsed.hostname.toLowerCase();
  if (!hostName.includes('amazon.') && !hostName.includes('google.')) {
    throw new Error('Only Amazon or Google URLs are supported');
  }
  return parsed;
}

function convertToAmazonReviewUrlIfPossible(url: URL): string {
  const isAmazon = url.hostname.toLowerCase().includes('amazon.');
  if (!isAmazon) {
    return url.toString();
  }
  const match = url.pathname.match(amazonAsinRegex);
  if (!match) {
    return url.toString();
  }
  const asin = match[1].toUpperCase();
  return `${url.protocol}//${url.host}/product-reviews/${asin}/?reviewerType=all_reviews`;
}

function getSignInMessage(targetUrl: string, title: string): string | null {
  const loweredUrl = targetUrl.toLowerCase();
  const loweredTitle = title.toLowerCase();

  if (
    loweredUrl.includes('amazon.') &&
    (loweredUrl.includes('/ap/signin') || loweredTitle.includes('sign in'))
  ) {
    return 'Amazon sign-in is required. Please log in and retry.';
  }

  if (
    loweredUrl.includes('google.') &&
    (loweredUrl.includes('accounts.google.com') || loweredTitle.includes('sign in'))
  ) {
    return 'Google sign-in is required. Please log in and retry.';
  }

  return null;
}

function getSignInMessageFromHtml(targetUrl: string, html: string): string | null {
  const loweredHtml = html.toLowerCase();
  const titleMatch = loweredHtml.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? '';
  return getSignInMessage(targetUrl, title);
}

function getAntiBotMessageFromHtml(targetUrl: string, html: string): string | null {
  const loweredHtml = html.toLowerCase();
  const isAmazon = targetUrl.toLowerCase().includes('amazon.');
  if (!isAmazon) {
    return null;
  }
  if (
    loweredHtml.includes('/errors_page/validatecaptcha') ||
    loweredHtml.includes('to discuss automated access to amazon data') ||
    loweredHtml.includes('continue shopping')
  ) {
    return 'Amazon blocked this curl request with an anti-bot/captcha page. Direct curl scraping is blocked.';
  }
  return null;
}

async function fetchHtmlWithCurl(sourceUrl: string): Promise<CurlFetchResponse> {
  const parsed = ensureSupportedUrl(sourceUrl);
  const targetUrl = convertToAmazonReviewUrlIfPossible(parsed);
  const args = [
    '-L',
    '--max-time',
    '60',
    '--compressed',
    '-A',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    '-H',
    'Accept-Language: en-US,en;q=0.9',
    targetUrl,
  ];
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 20 * 1024 * 1024 });
  const signInMessage = getSignInMessageFromHtml(targetUrl, stdout);
  if (signInMessage) {
    throw new Error(signInMessage);
  }
  const antiBotMessage = getAntiBotMessageFromHtml(targetUrl, stdout);
  if (antiBotMessage) {
    throw new Error(antiBotMessage);
  }
  return {
    sourceUrl,
    fetchedUrl: targetUrl,
    html: stdout,
  };
}

function parseReviewsFromRawText(reviewsText: string): string[] {
  return reviewsText
    .split(/\r?\n\s*\r?\n/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function quoteForCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isProbablyCsvContent(reviewsText: string): boolean {
  const lines = reviewsText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return false;
  }
  const firstLine = lines[0];
  const secondLine = lines[1];
  return firstLine.includes(',') && secondLine.includes(',');
}

async function writeReviewsToTempCsv(reviewsText: string): Promise<string> {
  const trimmedInput = reviewsText.trim();
  if (!trimmedInput) {
    throw new Error('At least one review is required');
  }
  const reviews = parseReviewsFromRawText(reviewsText);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'reviewlens-context-'));
  const filePath = path.join(tempDir, `reviews-${randomUUID()}.csv`);

  if (isProbablyCsvContent(trimmedInput)) {
    await writeFile(filePath, trimmedInput, 'utf8');
    return filePath;
  }

  if (reviews.length === 0) {
    throw new Error('At least one review is required');
  }

  const rows = ['review_id,review_text'];
  for (let index = 0; index < reviews.length; index += 1) {
    const reviewText = reviews[index].replace(/\r?\n/g, ' ');
    rows.push(`${quoteForCsv(`r${index + 1}`)},${quoteForCsv(reviewText)}`);
  }
  await writeFile(filePath, rows.join('\n'), 'utf8');
  return filePath;
}

function getReviewLensToken(providedToken: unknown): string {
  if (typeof providedToken === 'string' && providedToken.trim().length > 0) {
    return providedToken.trim();
  }
  if (process.env.REVIEWLENS_BEARER_TOKEN && process.env.REVIEWLENS_BEARER_TOKEN.trim().length > 0) {
    return process.env.REVIEWLENS_BEARER_TOKEN.trim();
  }
  throw new Error(
    'Missing bearer token. Provide bearerToken in request or configure REVIEWLENS_BEARER_TOKEN on API server.',
  );
}

function getReviewLensBaseUrl(): string {
  const configured = process.env.REVIEWLENS_API_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  throw new Error('REVIEWLENS_API_BASE_URL is not configured. Set it in apps/api/.env');
}

function getFrontVersion(): string {
  return process.env.FRONT_VERSION?.trim() || '1.0.0';
}

async function callReviewLensIngest(params: {
  filePath: string;
  platform: string;
  entityName: string;
  bearerToken: string;
}): Promise<ReviewLensIngestSummary> {
  const response = await fetch(`${getReviewLensBaseUrl()}/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.bearerToken}`,
    },
    body: JSON.stringify({
      file_path: params.filePath,
      platform: params.platform,
      entity_name: params.entityName,
    }),
  });
  const payload = (await response.json()) as ReviewLensIngestSummary | { detail?: string };
  if (!response.ok) {
    const detail = 'detail' in payload && typeof payload.detail === 'string' ? payload.detail : 'Ingest failed';
    throw new Error(detail);
  }
  return payload as ReviewLensIngestSummary;
}

async function callReviewLensChat(params: {
  datasetId: string;
  question: string;
  topK: number;
  bearerToken: string;
}): Promise<ReviewLensChatResponse> {
  const response = await fetch(`${getReviewLensBaseUrl()}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.bearerToken}`,
    },
    body: JSON.stringify({
      dataset_id: params.datasetId,
      question: params.question,
      top_k: params.topK,
    }),
  });
  const payload = (await response.json()) as ReviewLensChatResponse | { detail?: string };
  if (!response.ok) {
    const detail = 'detail' in payload && typeof payload.detail === 'string' ? payload.detail : 'Chat failed';
    throw new Error(detail);
  }
  return payload as ReviewLensChatResponse;
}

async function callReviewLensAuthenticate(authKey: string): Promise<ReviewLensAuthenticateResponse> {
  const response = await fetch(`${getReviewLensBaseUrl()}/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Key': authKey,
    },
  });
  const payload = (await response.json()) as ReviewLensAuthenticateResponse | { detail?: string };
  if (!response.ok) {
    const detail =
      'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Authentication failed';
    throw new Error(detail);
  }
  return payload as ReviewLensAuthenticateResponse;
}

async function callReviewLensHealth(): Promise<ReviewLensHealthResponse> {
  const response = await fetch(`${getReviewLensBaseUrl()}/health`);
  const payload = (await response.json()) as ReviewLensHealthResponse | { detail?: string };
  if (!response.ok) {
    const detail =
      'detail' in payload && typeof payload.detail === 'string'
        ? payload.detail
        : 'Failed to fetch chat AI version';
    throw new Error(detail);
  }
  return payload as ReviewLensHealthResponse;
}

app.post('/api/fetch-page-html', async (req, res) => {
  try {
    const sourceUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!sourceUrl) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'URL is required',
      } satisfies ApiResponse<null>);
    }

    const fetched = await fetchHtmlWithCurl(sourceUrl);
    return res.json({
      success: true,
      data: fetched,
    } satisfies ApiResponse<CurlFetchResponse>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch page with curl';
    await writeLog('WARNING', `POST /api/fetch-page-html failed: ${message}`);
    const isSignInError = message.toLowerCase().includes('sign-in');
    return res.status(isSignInError ? 401 : 502).json({
      success: false,
      data: null,
      error: message,
    } satisfies ApiResponse<null>);
  }
});

app.post('/api/reviewlens/ingest-context', async (req, res) => {
  try {
    const reviewsText = typeof req.body?.reviewsText === 'string' ? req.body.reviewsText : '';
    const platform = typeof req.body?.platform === 'string' ? req.body.platform.trim() : '';
    const entityName = typeof req.body?.entityName === 'string' ? req.body.entityName.trim() : '';

    if (!reviewsText.trim()) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'reviewsText is required',
      } satisfies ApiResponse<null>);
    }
    if (!platform) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'platform is required',
      } satisfies ApiResponse<null>);
    }
    if (!entityName) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'entityName is required',
      } satisfies ApiResponse<null>);
    }

    const bearerToken = getReviewLensToken(req.body?.bearerToken);
    const filePath = await writeReviewsToTempCsv(reviewsText);
    const summary = await callReviewLensIngest({
      filePath,
      platform,
      entityName,
      bearerToken,
    });

    return res.json({
      success: true,
      data: summary,
    } satisfies ApiResponse<ReviewLensIngestSummary>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set context';
    await writeLog('WARNING', `POST /api/reviewlens/ingest-context failed: ${message}`);
    return res.status(502).json({
      success: false,
      data: null,
      error: message,
    } satisfies ApiResponse<null>);
  }
});

app.post('/api/reviewlens/authenticate', async (req, res) => {
  try {
    const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey.trim() : '';
    if (!authKey) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'authKey is required',
      } satisfies ApiResponse<null>);
    }
    const authenticated = await callReviewLensAuthenticate(authKey);
    return res.json({
      success: true,
      data: {
        bearerToken: authenticated.bearer_token,
      },
    } satisfies ApiResponse<{ bearerToken: string }>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to authenticate';
    await writeLog('WARNING', `POST /api/reviewlens/authenticate failed: ${message}`);
    const statusCode = message.toLowerCase().includes('auth key') ? 401 : 502;
    return res.status(statusCode).json({
      success: false,
      data: null,
      error: message,
    } satisfies ApiResponse<null>);
  }
});

app.get('/api/reviewlens/versions', async (req, res) => {
  try {
    const chatHealth = await callReviewLensHealth();
    return res.json({
      success: true,
      data: {
        frontVersion: getFrontVersion(),
        chatVersion: chatHealth.version || 'unknown',
      },
    } satisfies ApiResponse<{ frontVersion: string; chatVersion: string }>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch versions';
    await writeLog('WARNING', `GET /api/reviewlens/versions failed: ${message}`);
    return res.status(502).json({
      success: false,
      data: null,
      error: message,
    } satisfies ApiResponse<null>);
  }
});

app.post('/api/reviewlens/chat', async (req, res) => {
  try {
    const datasetId = typeof req.body?.datasetId === 'string' ? req.body.datasetId.trim() : '';
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    const topKRaw = typeof req.body?.topK === 'number' ? req.body.topK : 30;
    const topK = Math.max(3, Math.min(30, Math.trunc(topKRaw)));

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'datasetId is required',
      } satisfies ApiResponse<null>);
    }
    if (!question) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'question is required',
      } satisfies ApiResponse<null>);
    }

    const bearerToken = getReviewLensToken(req.body?.bearerToken);
    const answer = await callReviewLensChat({
      datasetId,
      question,
      topK,
      bearerToken,
    });

    return res.json({
      success: true,
      data: answer,
    } satisfies ApiResponse<ReviewLensChatResponse>);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to chat';
    await writeLog('WARNING', `POST /api/reviewlens/chat failed: ${message}`);
    return res.status(502).json({
      success: false,
      data: null,
      error: message,
    } satisfies ApiResponse<null>);
  }
});

// Products endpoints
app.get('/api/products', (req, res) => {
  try {
    const filter: ProductFilter = {};

    if (req.query.category) {
      filter.category = req.query.category as string;
    }
    if (req.query.minPrice) {
      filter.minPrice = Number(req.query.minPrice);
    }
    if (req.query.maxPrice) {
      filter.maxPrice = Number(req.query.maxPrice);
    }
    if (req.query.inStock !== undefined) {
      filter.inStock = req.query.inStock === 'true';
    }
    if (req.query.searchTerm) {
      filter.searchTerm = req.query.searchTerm as string;
    }

    const pageNumber = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 10;

    const result = productsService.getProducts(filter, pageNumber, pageSize);

    const response: ApiResponse<PaginatedResponse<Product>> = {
      data: result,
      success: true,
    };

    res.json(response);
  } catch {
    void writeLog('ERROR', 'GET /api/products failed');
    const response: ApiResponse<null> = {
      data: null,
      success: false,
      error: 'An error occurred while fetching products',
    };
    res.status(500).json(response);
  }
});

app.get('/api/products/categories', (req, res) => {
  try {
    const categories = productsService.getCategories();
    const response: ApiResponse<string[]> = {
      data: categories,
      success: true,
    };
    res.json(response);
  } catch {
    void writeLog('ERROR', 'GET /api/products/categories failed');
    const response: ApiResponse<null> = {
      data: null,
      success: false,
      error: 'An error occurred while fetching categories',
    };
    res.status(500).json(response);
  }
});

app.get('/api/products/:id', (req, res) => {
  try {
    const product = productsService.getProductById(req.params.id);

    if (!product) {
      const response: ApiResponse<null> = {
        data: null,
        success: false,
        error: 'Product not found',
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse<Product> = {
      data: product,
      success: true,
    };
    return res.json(response);
  } catch {
    void writeLog('ERROR', `GET /api/products/${req.params.id} failed`);
    const response: ApiResponse<null> = {
      data: null,
      success: false,
      error: 'An error occurred while fetching the product',
    };
    return res.status(500).json(response);
  }
});

app.listen(port, host, () => {
  console.log(`[ ready ] http://${host}:${port}`);
});
