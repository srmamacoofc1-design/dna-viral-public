import { supabase } from '@/integrations/supabase/client';

/**
 * Real frame extractor using browser <video> + <canvas>.
 * Downloads video from Supabase Storage, seeks to timestamps, captures JPEG frames,
 * uploads them back to Storage, and registers in video_frames.
 */

const FRAME_WIDTH = 640;
const FRAME_QUALITY = 0.85;

type BlockInfo = {
  id: string;
  bloco_id: number;
  tempo_inicio: number;
  tempo_fim: number;
};

type FrameResult = {
  video_id: string;
  block_id: string;
  frame_number: number;
  timestamp_seconds: number;
  file_path: string;
  frame_hash: string;
  frame_role: string;
  source_method: string;
  scene_change_flag: boolean;
};

/** Generate a simple hash from an ArrayBuffer (MD5-like via SubtleCrypto SHA-256 truncated to 32 hex chars) */
async function generateFrameHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

/** Load a video element and wait for it to be ready */
function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      video.src = '';
      reject(new Error('Video load timeout (60s)'));
    }, 60000);

    video.addEventListener('loadeddata', () => {
      clearTimeout(timeout);
      resolve(video);
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      const code = video.error?.code;
      const msg = video.error?.message || 'Unknown video error';
      reject(new Error(`Video load error (code ${code}): ${msg}`));
    }, { once: true });

    video.src = url;
    video.load();
  });
}

/** Seek the video to a specific time and wait for the frame to be ready */
function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Seek timeout at ${time}s`)), 15000);

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });

    // Clamp to valid range
    const clampedTime = Math.min(Math.max(0, time), video.duration - 0.01);
    video.currentTime = clampedTime;
  });
}

/** Capture a frame from the video as a JPEG Blob */
function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      const aspectRatio = video.videoHeight / video.videoWidth;
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round(FRAME_WIDTH * aspectRatio);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob returned null'));
        },
        'image/jpeg',
        FRAME_QUALITY,
      );
    } catch (e) {
      reject(e);
    }
  });
}

/** Extract real structural frames for a video's blocks */
export async function extractRealStructuralFrames(
  videoId: string,
  blocks: BlockInfo[],
  onFrameProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!blocks.length) {
    return { ok: false, count: 0, error: 'No blocks provided' };
  }

  // 1. Get video file path from metadata
  const { data: metaRows } = await supabase
    .from('video_metadata')
    .select('valor')
    .eq('video_id', videoId)
    .eq('chave', 'file_path')
    .limit(1);

  const filePath = metaRows?.[0]?.valor;
  if (!filePath) {
    return { ok: false, count: 0, error: 'No video file_path found in metadata' };
  }

  // 2. Get public URL from Supabase Storage
  const { data: urlData } = supabase.storage.from('videos').getPublicUrl(filePath);
  const videoUrl = urlData?.publicUrl;
  if (!videoUrl) {
    return { ok: false, count: 0, error: 'Cannot construct public URL for video' };
  }

  // 3. Load video in browser
  let video: HTMLVideoElement;
  try {
    video = await loadVideo(videoUrl);
  } catch (e) {
    return { ok: false, count: 0, error: `Failed to load video: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 4. Delete old structural frames only (preserve scene_detection)
  await supabase
    .from('video_frames')
    .delete()
    .eq('video_id', videoId)
    .eq('source_method', 'block_structural_extraction');

  // Also delete old files from storage (best effort)
  try {
    const { data: oldFiles } = await supabase.storage
      .from('videos')
      .list(`frames/${videoId}/structural`);
    if (oldFiles?.length) {
      const paths = oldFiles.map(f => `frames/${videoId}/structural/${f.name}`);
      await supabase.storage.from('videos').remove(paths);
    }
  } catch { /* best effort */ }

  // 5. Extract and upload frames
  const totalFrames = blocks.length * 3;
  const frameRecords: FrameResult[] = [];
  let frameNumber = 1;
  let processedCount = 0;

  for (const block of blocks) {
    const start = Number(block.tempo_inicio);
    const end = Number(block.tempo_fim);
    const middle = Math.round(((start + end) / 2) * 1000) / 1000;

    const roles: { role: string; ts: number }[] = [
      { role: 'start', ts: start },
      { role: 'middle', ts: middle },
      { role: 'end', ts: end },
    ];

    for (const { role, ts } of roles) {
      try {
        // Seek
        await seekToTime(video, ts);

        // Capture
        const blob = await captureFrame(video);
        const arrayBuffer = await blob.arrayBuffer();

        // Hash
        const frameHash = await generateFrameHash(arrayBuffer);

        // Upload path: videos/frames/{video_id}/structural/block_{bloco_id}_{role}.jpg
        const storagePath = `frames/${videoId}/structural/block_${String(block.bloco_id).padStart(3, '0')}_${role}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('videos')
          .upload(storagePath, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Upload error for ${storagePath}:`, uploadErr);
          // Continue with other frames
          processedCount++;
          onFrameProgress?.(processedCount, totalFrames);
          continue;
        }

        const fullPath = `videos/${storagePath}`;

        frameRecords.push({
          video_id: videoId,
          block_id: block.id,
          frame_number: frameNumber,
          timestamp_seconds: ts,
          file_path: fullPath,
          frame_hash: frameHash,
          frame_role: role,
          source_method: 'block_structural_extraction',
          scene_change_flag: false,
        });

        frameNumber++;
      } catch (e) {
        console.error(`Frame extraction failed for block ${block.bloco_id} ${role}:`, e);
        // Continue with other frames
      }

      processedCount++;
      onFrameProgress?.(processedCount, totalFrames);
    }
  }

  // Cleanup video element
  video.pause();
  video.src = '';
  video.load();

  // 6. Insert frame records to database
  if (frameRecords.length === 0) {
    return { ok: false, count: 0, error: 'No frames were successfully extracted' };
  }

  const { error: insertErr } = await supabase.from('video_frames').insert(frameRecords);
  if (insertErr) {
    return { ok: false, count: 0, error: `Insert frames failed: ${insertErr.message}` };
  }

  return { ok: true, count: frameRecords.length };
}
