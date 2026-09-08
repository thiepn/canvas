export interface CanvasEnv {
  CANVAS_ROOM: DurableObjectNamespace
  ALLOWED_ORIGINS: string
  ADMIN_TOKEN?: string
  APP_ENV?: 'production' | 'test'
}
