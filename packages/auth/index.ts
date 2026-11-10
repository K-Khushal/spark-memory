// Public entry point of @spark/auth (server side). Browser code imports
// @spark/auth/client instead.
export {
  createAuth,
  enabledSocialProviders,
  SOCIAL_PROVIDERS,
  type Auth,
  type AuthConfig,
  type SocialProvider,
} from "./lib/auth";
export { resendSender, type SignInCodeSender } from "./lib/email";
