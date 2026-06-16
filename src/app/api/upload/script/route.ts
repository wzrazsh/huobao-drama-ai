// ============================================================
// POST /api/upload/script — Parse a novel/script file
//
// Accepts a multipart/form-data payload with:
//   - file: a .txt or .docx file (required)
//
// On success, returns the extracted plain text plus basic file
// metadata. The caller is expected to take the text and push it
// through the rest of the script pipeline (AI rewrite, asset
// extraction, etc.). The shape matches what
// src/lib/api.ts:1266 declares as the contract for api.upload.script().
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { parseNovelFile } from '@/lib/novel-parser'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_EXTS: Record<string, true> = {
  '.txt': true,
  '.md': true,
  '.docx': true,
  '.pdf': true,
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: '缺少文件' }, { status: 400 })
    }

    const lowerName = file.name.toLowerCase()
    const ext = lowerName.slice(lowerName.lastIndexOf('.'))
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `文件过大: 上限 10MB` },
        { status: 413 }
      )
    }
    if (!ALLOWED_EXTS[ext]) {
      return NextResponse.json(
        { error: `不支持的文件类型: ${ext}（允许: ${Object.keys(ALLOWED_EXTS).join(', ')}）` },
        { status: 400 }
      )
    }

    // parseNovelFile only handles .txt and .docx. For .md and .pdf we
    // fall back to a plain UTF-8 decode (or, for .pdf, a clear error
    // since the project doesn't bundle a PDF parser here).
    let text: string
    const buffer = Buffer.from(await file.arrayBuffer())

    if (ext === '.pdf') {
      return NextResponse.json(
        { error: 'PDF 解析暂未实现，请上传 .txt / .md / .docx' },
        { status: 415 }
      )
    }

    if (ext === '.md' || ext === '.txt') {
      text = buffer.toString('utf-8')
    } else {
      // .docx — delegate to mammoth via the existing parser
      text = await parseNovelFile(buffer, file.name)
    }

    // Strip BOM if present, normalize line endings
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Trim trailing whitespace per line; collapse runs of blank lines
    // at the very end only — keep internal paragraph structure intact
    // so chapter detection (downstream) still works.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '\n')

    return NextResponse.json({
      text,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || ext.slice(1),
      charCount: Array.from(text).length,
    })
  } catch (error) {
    console.error('[upload/script] Failed:', error)
    return NextResponse.json(
      { error: '剧本解析失败', detail: (error as Error).message },
      { status: 500 }
    )
  }
}
