// ============================================================
// Tencent COS Storage Integration
// Uploads local character/scene images to a public COS bucket
// so providers like MiniMax can reference them via HTTP URL.
// ============================================================

import COS from 'cos-nodejs-sdk-v5'
import { readMediaFile, isFileStorageUrl } from './file-storage'
import path from 'path'

// Re-export COS namespace types for local signatures
import type COSNamespace from 'cos-nodejs-sdk-v5'

type CosOptions = COSNamespace.COSOptions
type PutObjectParams = COSNamespace.PutObjectParams
type PutObjectResult = COSNamespace.PutObjectResult

// ============================================================
// Configuration
// ============================================================

const SECRET_ID = process.env.TENCENT_COS_SECRET_ID ?? ''
const SECRET_KEY = process.env.TENCENT_COS_SECRET_KEY ?? ''
const BUCKET = process.env.TENCENT_COS_BUCKET ?? ''
const REGION = process.env.TENCENT_COS_REGION ?? ''
const PREFIX = (process.env.TENCENT_COS_PREFIX ?? 'huobao-drama-ai/characters').replace(/\/$/, '')

function getCosClient(): COS {
  if (!SECRET_ID || !SECRET_KEY || !BUCKET || !REGION) {
    throw new Error(
      'Tencent COS is not configured. Set TENCENT_COS_SECRET_ID, TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET and TENCENT_COS_REGION.'
    )
  }
  const options: CosOptions = {
    SecretId: SECRET_ID,
    SecretKey: SECRET_KEY,
  }
  return new COS(options)
}

function isConfigured(): boolean {
  return Boolean(SECRET_ID && SECRET_KEY && BUCKET && REGION)
}

/**
 * Build the publicly accessible HTTPS URL for a COS object key.
 */
export function buildCosPublicUrl(key: string): string {
  const normalizedKey = key.replace(/^\//, '')
  return `https://${BUCKET}.cos.${REGION}.myqcloud.com/${normalizedKey}`
}

/**
 * Determine MIME type from a local storage URL path.
 */
function mimeTypeFromUrl(url: string): string {
  const ext = path.extname(url).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }
  return map[ext] ?? 'image/png'
}

/**
 * Extract a stable filename from a local storage URL.
 * Falls back to a timestamped random name.
 */
function filenameFromUrl(url: string): string {
  const base = path.basename(url)
  if (base && base.includes('.')) return base
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.png`
}

export interface CosUploadResult {
  url: string
  key: string
  etag: string
}

/**
 * Upload a local file-storage image to Tencent COS.
 *
 * @param localUrl - URL returned by file-storage, e.g. /api/files/dramas/xxx/characters/yyy.png
 * @param keyPrefix - Optional sub-prefix inside the configured COS prefix
 * @returns Public HTTPS URL of the uploaded object
 */
export async function uploadImageToCos(
  localUrl: string,
  keyPrefix?: string
): Promise<CosUploadResult> {
  if (!isConfigured()) {
    throw new Error('Tencent COS is not configured')
  }
  if (!isFileStorageUrl(localUrl)) {
    throw new Error(`Cannot upload non-local URL to COS: ${localUrl}`)
  }

  const buffer = await readMediaFile(localUrl)
  if (!buffer) {
    throw new Error(`Local file not found: ${localUrl}`)
  }

  const fileName = filenameFromUrl(localUrl)
  const subPrefix = keyPrefix ? `${keyPrefix}/` : ''
  const key = `${PREFIX}/${subPrefix}${fileName}`

  const cos = getCosClient()
  const params: PutObjectParams = {
    Bucket: BUCKET,
    Region: REGION,
    Key: key,
    Body: buffer,
    ContentType: mimeTypeFromUrl(localUrl),
    // Public-read so MiniMax can fetch it without signatures.
    ACL: 'public-read',
  }

  const result: PutObjectResult = await cos.putObject(params)

  return {
    url: buildCosPublicUrl(key),
    key,
    etag: result.ETag,
  }
}

/**
 * Upload a character's main image to COS and return the public URL.
 */
export async function uploadCharacterImageToCos(
  characterId: string,
  localUrl: string
): Promise<CosUploadResult> {
  return uploadImageToCos(localUrl, characterId)
}

/**
 * Upload a character appearance image to COS and return the public URL.
 */
export async function uploadAppearanceImageToCos(
  characterId: string,
  appearanceIndex: number,
  localUrl: string
): Promise<CosUploadResult> {
  return uploadImageToCos(localUrl, `${characterId}/appearance-${appearanceIndex}`)
}

/**
 * For a local file-storage URL, return a COS public URL.
 * If the URL is already a public COS URL, return it unchanged.
 * If COS is not configured, returns null.
 */
export async function resolvePublicImageUrl(
  localUrl: string | null | undefined,
  keyPrefix?: string
): Promise<string | null> {
  if (!localUrl) return null
  if (localUrl.includes('.cos.') && localUrl.includes('.myqcloud.com')) {
    return localUrl
  }
  if (!isFileStorageUrl(localUrl)) {
    // Already an external URL (data URL, http public URL, etc.)
    return localUrl.startsWith('http') ? localUrl : null
  }
  if (!isConfigured()) return null

  const { url } = await uploadImageToCos(localUrl, keyPrefix)
  return url
}

interface CharacterImageReference {
  id: string
  imageUrl: string | null
  cosImageUrl: string | null
}

export interface CharacterReferenceResolution {
  urls: string[]
  uploaded: Array<{ id: string; url: string; key?: string }>
}

/**
 * Resolve a list of character references into public COS URLs suitable for MiniMax.
 * Uses cached cosImageUrl when available; otherwise uploads the local image on demand.
 */
export async function resolveCharacterReferencesForMiniMax(
  references: CharacterImageReference[],
  keyPrefix?: string
): Promise<CharacterReferenceResolution> {
  const urls: string[] = []
  const uploaded: Array<{ id: string; url: string; key?: string }> = []
  for (const ref of references) {
    if (ref.cosImageUrl) {
      urls.push(ref.cosImageUrl)
      continue
    }
    if (!ref.imageUrl) continue
    const result = await uploadImageToCos(ref.imageUrl, keyPrefix ?? ref.id)
    urls.push(result.url)
    uploaded.push({ id: ref.id, url: result.url, key: result.key })
  }
  return {
    urls: Array.from(new Set(urls)).slice(0, 4),
    uploaded,
  }
}
