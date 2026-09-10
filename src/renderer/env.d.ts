import type { DelaApi } from '../shared/api';

declare global {
  interface Window {
    dela?: DelaApi;
  }
}
