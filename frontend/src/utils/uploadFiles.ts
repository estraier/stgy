import { getTrackFileKind } from "./tracks";

const TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown"]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "tif",
  "tiff",
  "gif",
  "bmp",
  "svg",
]);

export type ClassifiedUploadFiles = {
  textFiles: File[];
  imageFiles: File[];
  trackFiles: File[];
  unsupportedFiles: File[];
};

export function classifyEditorUploadFiles(files: File[]): ClassifiedUploadFiles {
  const result: ClassifiedUploadFiles = {
    textFiles: [],
    imageFiles: [],
    trackFiles: [],
    unsupportedFiles: [],
  };

  files.forEach((file) => {
    if (getTrackFileKind(file.name)) {
      result.trackFiles.push(file);
    } else if (isImageFile(file)) {
      result.imageFiles.push(file);
    } else if (isTextFile(file)) {
      result.textFiles.push(file);
    } else {
      result.unsupportedFiles.push(file);
    }
  });

  return result;
}

export function getEditorUploadSelectionError(files: ClassifiedUploadFiles): string | null {
  if (files.imageFiles.length > 0 && files.trackFiles.length > 0) {
    return "Images and tracks cannot be uploaded simultaneously.";
  }
  if (files.unsupportedFiles.length > 0) {
    const names = files.unsupportedFiles.map((file) => file.name).join(", ");
    return `Unsupported file type: ${names}`;
  }
  return null;
}

function isTextFile(file: File): boolean {
  const extension = getExtension(file.name);
  return (
    file.type.startsWith("text/") || file.type === "text/markdown" || TEXT_EXTENSIONS.has(extension)
  );
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.has(getExtension(file.name));
}

function getExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() || "";
}
