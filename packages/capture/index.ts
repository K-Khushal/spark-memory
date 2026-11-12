// Public entry point of @spark/capture. Keep it small; put implementation in lib/.
export {
  checkImage,
  keptType,
  prepareImage,
  type ImageRefusal,
  type PreparedImage,
} from "./lib/image";
export {
  checkPdf,
  isPdf,
  preparePdf,
  type PageImage,
  type PreparedPdf,
} from "./lib/pdf";
export { dominantColours } from "./lib/palette";
export { placeholderUrl } from "./lib/placeholder";
