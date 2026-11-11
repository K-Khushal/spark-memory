// Public entry point of @spark/capture. Keep it small; put implementation in lib/.
export {
  checkImage,
  keptType,
  prepareImage,
  type ImageRefusal,
  type PreparedImage,
} from "./lib/image";
export { placeholderUrl } from "./lib/placeholder";
