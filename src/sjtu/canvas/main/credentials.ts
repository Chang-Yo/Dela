import { hostPorts } from '../../../core/ports';

export function saveCanvasToken(token: string): void {
  hostPorts().secrets.write('canvas-token', token);
}

export function loadCanvasToken(): string | null {
  return hostPorts().secrets.read('canvas-token');
}

export function clearCanvasToken(): void {
  hostPorts().secrets.remove('canvas-token');
}
