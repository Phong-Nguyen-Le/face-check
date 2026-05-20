import type { Layout } from "@/types/enroll";

// Camera buffer size (portrait, hd1280x720)
export const SOURCE_W = 720;
export const SOURCE_H = 1280;

// Oval guide size — must match GuidedEnrollModal StyleSheet
export const OVAL_W = 220 * 1.2;
export const OVAL_H = 290 * 1.2;

export const faceToScreenRect = (
  face: { x: number; y: number; width: number; height: number },
  layout: Layout,
) => {
  const scale = Math.min(layout.width / SOURCE_W, layout.height / SOURCE_H);
  const displayW = SOURCE_W * scale;
  const displayH = SOURCE_H * scale;
  const offsetX = (layout.width - displayW) / 2;
  const offsetY = (layout.height - displayH) / 2;
  return {
    x: offsetX + face.x * displayW,
    y: offsetY + face.y * displayH,
    width: face.width * displayW,
    height: face.height * displayH,
  };
};

export const getOvalRect = (layout: Layout) => ({
  x: layout.width / 2 - OVAL_W / 2,
  y: layout.height / 2 - OVAL_H / 2,
  width: OVAL_W,
  height: OVAL_H,
});

// Thresholds for face-in-oval validation
const FACE_SIZE_MIN = 0.85; // face width must be at least 85% of oval width
const FACE_SIZE_MAX = 1.15; // face width must be at most 115% of oval width
const FACE_CENTER_TOLERANCE = 0.15; // face center must be within 15% of oval dimensions

// Messages returned when the face doesn't meet a threshold
export const FACE_ISSUE_MESSAGES = {
  tooFar: "Lại gần camera hơn",
  tooClose: "Lùi xa camera hơn",
  offCenter: "Căn giữa khuôn mặt vào khung hình",
} as const;

export const getFaceIssue = (
  face: { x: number; y: number; width: number; height: number },
  layout: Layout,
): string | null => {
  if (!layout.width || !layout.height) return null;
  const oval = getOvalRect(layout);
  const faceRect = faceToScreenRect(face, layout);

  const wRatio = faceRect.width / oval.width;
  if (wRatio < FACE_SIZE_MIN) return FACE_ISSUE_MESSAGES.tooFar;
  if (wRatio > FACE_SIZE_MAX) return FACE_ISSUE_MESSAGES.tooClose;

  const faceCX = faceRect.x + faceRect.width / 2;
  const faceCY = faceRect.y + faceRect.height / 2;
  const ovalCX = oval.x + oval.width / 2;
  const ovalCY = oval.y + oval.height / 2;
  if (
    Math.abs(faceCX - ovalCX) > oval.width * FACE_CENTER_TOLERANCE ||
    Math.abs(faceCY - ovalCY) > oval.height * FACE_CENTER_TOLERANCE
  )
    return FACE_ISSUE_MESSAGES.offCenter;

  return null;
};
