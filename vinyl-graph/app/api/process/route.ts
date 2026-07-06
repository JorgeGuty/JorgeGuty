import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { createJob, updateJob } from '@/lib/jobs';
import { runPipeline } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 3600;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Falta ANTHROPIC_API_KEY en el entorno del servidor.' },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get('video');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Envía un archivo en el campo "video".' }, { status: 400 });
  }

  const job = createJob();
  const projectRoot = process.cwd();
  const uploadDir = path.join(projectRoot, '.tmp', job.id);
  await fs.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(file.name || '.mp4') || '.mp4';
  const videoPath = path.join(uploadDir, `video${ext}`);
  await fs.writeFile(videoPath, Buffer.from(await file.arrayBuffer()));

  updateJob(job.id, { percent: 3, message: 'Video recibido.' });

  // Fire and forget — the client polls /api/process/[id] for progress.
  runPipeline(job.id, videoPath, projectRoot);

  return NextResponse.json({ jobId: job.id });
}
