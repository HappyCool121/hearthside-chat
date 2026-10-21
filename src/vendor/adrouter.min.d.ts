// Declarations for the vendored @adrouter/browser-sdk 0.4.0 bundle (see SOURCE.json). Only what Hearthside uses.
export interface Sponsor {
  offer_id: string; request_id: string; placement_id: string; creative_revision_id: string;
  disclosure: 'Sponsored' | 'Ad'; synthetic: boolean;
  creative: { advertiser_name: string; title: string; body: string; destination_url: string };
  issued_at: string; expires_at: string; reporting_receipt: string;
  measurement: { minimum_ratio: 0.5; continuous_ms: 1000 };
}
export interface AdRouterError { code: string; message: string; status?: number }
export interface TrackState { rendered: boolean; viewed: boolean; clicked: boolean; ended: string | null }
export interface TrackHandle { readonly state: TrackState; check(): TrackState; dismiss(): void; dispose(): void }
export interface AdRouter {
  match(prompt: string, options?: { placementId?: string; signal?: AbortSignal; idempotencyKey?: string }): Promise<Sponsor | null>;
  render(sponsor: Sponsor, container: HTMLElement, options?: { unstyled?: boolean; linkText?: string; onState?: (state: TrackState) => void }): TrackHandle;
  dispose(): void;
}
export function createAdRouter(options: { publicKey: string; apiOrigin?: string; timeoutMs?: number; onError?: (error: AdRouterError) => void }): AdRouter;
export const SDK_VERSION: string;
