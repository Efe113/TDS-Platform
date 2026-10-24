import { supabase } from './supabase'
import { NotConfiguredError } from './discovery-api'

/**
 * Avatar, banner and VIP background uploads. Static images are re-encoded in the renderer before
 * they leave the machine: a phone screenshot dropped into the banner slot would otherwise be a
 * multi-megabyte PNG in a public bucket. A GIF is the one exception - canvas encoding would strip
 * the animation, so it is uploaded as-is under a hard size cap. Cropping is left to CSS.
 *
 * The project runs on the Supabase free tier: one file per slot, the previous file is deleted after
 * the new one lands, and every upload is capped at 10 MB.
 */

const BUCKET = 'strategy-media'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export type ProfileMediaKind = 'avatar' | 'banner' | 'background'

const LIMITS: Record<ProfileMediaKind, { max: number; quality: number }> = {
  avatar: { max: 512, quality: 0.9 },
  banner: { max: 1600, quality: 0.85 },
  background: { max: 1920, quality: 0.88 }
}

export interface UploadTarget {
  kind: ProfileMediaKind
  userId: string
}

const EXTENSION_TYPES: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

/** Some sources hand over a File with an empty type; fall back to the extension rather than reject. */
function normalizedType(file: File): string {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLocaleLowerCase() ?? ''
  return EXTENSION_TYPES[extension] ?? ''
}

async function readImage(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error('IMAGE_INVALID')
  }
}

/** Scales down to `max` on the long edge and encodes to WebP (falling back to JPEG). */
async function encode(bitmap: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_UNAVAILABLE')
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const webp = await canvas.convertToBlob({ type: 'image/webp', quality })
  if (webp.type === 'image/webp') return webp
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}

function extensionFor(type: string): string {
  if (type === 'image/gif') return 'gif'
  return type === 'image/webp' ? 'webp' : 'jpg'
}

/**
 * Returns the storage path (not a URL): the path is what the profile row stores, so the public URL is
 * derived on read and a CDN/base change never rewrites rows.
 */
export async function uploadProfileImage(target: UploadTarget, file: File, previous: string | null): Promise<string> {
  if (!supabase) throw new NotConfiguredError()
  const type = normalizedType(file)
  if (!type.startsWith('image/')) throw new Error('IMAGE_INVALID')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('IMAGE_TOO_LARGE')

  const limit = LIMITS[target.kind]
  // An animated GIF must keep its bytes; every other image goes through the compressor.
  const blob = target.kind === 'background' && type === 'image/gif'
    ? file
    : await encode(await readImage(file), limit.max, limit.quality)
  const contentType = blob.type || type

  const prefix = target.kind === 'avatar' ? 'avatars' : target.kind === 'banner' ? 'banners' : 'backgrounds'
  const path = `${prefix}/${target.userId}/${String(Date.now())}.${extensionFor(contentType)}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType,
    cacheControl: '31536000',
    upsert: false
  })
  if (error) throw new Error(error.message)

  // The old file is removed only after the new one landed, so a failed upload never leaves the
  // profile without an image. A failed cleanup is not worth failing the save over.
  if (previous && previous !== path) {
    try {
      await supabase.storage.from(BUCKET).remove([previous])
    } catch {
      // orphaned file, harmless
    }
  }

  return path
}

export async function removeProfileImage(path: string): Promise<void> {
  if (!supabase) throw new NotConfiguredError()
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(error.message)
}
