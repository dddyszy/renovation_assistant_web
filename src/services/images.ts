export const noteImagePath = (base: string, noteId: string, imageId: string) =>
  `/api/v1${base}/notes/${noteId}/images/${imageId}`;

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;

export interface PreparedImage {
  data: string;
  mime: "image/jpeg";
  width: number;
  height: number;
  preview: string;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("图片不能超过 20MB");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("无法读取这张图片，请换一张或先转成 JPG");
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片处理");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const preview = canvas.toDataURL("image/jpeg", 0.82);
  const data = preview.split(",")[1] || "";
  if (data.length * 0.75 > 3 * 1024 * 1024)
    throw new Error("压缩后仍超过 3MB，请先裁剪或降低分辨率");
  return { data, mime: "image/jpeg", width, height, preview };
}
