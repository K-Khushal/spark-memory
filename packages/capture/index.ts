// Public entry point of @spark/capture. Keep it small; put implementation in lib/.
export {
  checkImage,
  keptType,
  prepareImage,
  type ImageRefusal,
  type PreparedImage,
} from "./lib/image";
export { dominantColours } from "./lib/palette";
export { placeholderUrl } from "./lib/placeholder";
