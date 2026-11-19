import type { DelaApi } from '../preload/api';

declare global {
  interface Window {
    dela?: DelaApi;
  }
}
