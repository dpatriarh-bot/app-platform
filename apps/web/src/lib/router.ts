// ============================================================
// router.ts — hash-роутер с параметрами и middleware
// Поддерживает query-параметры в ctx.query (для kiosk-токена).
// ============================================================

export interface RouteContext {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;
export type RouteGuard = (ctx: RouteContext) => boolean | Promise<boolean> | string;

interface Route {
  pattern: string;
  regex: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  guards: RouteGuard[];
  title?: string;
}

class Router {
  private routes: Route[] = [];
  private notFoundHandler: RouteHandler | null = null;
  private currentPath: string | null = null;

  register(
    pattern: string,
    handler: RouteHandler,
    options: { guards?: RouteGuard[]; title?: string } = {}
  ): void {
    const paramNames: string[] = [];
    const regexSource = pattern
      .replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name: string) => {
        paramNames.push(name);
        return '/([^/]+)';
      })
      .replace(/\//g, '\\/');

    this.routes.push({
      pattern,
      regex: new RegExp(`^${regexSource}$`),
      paramNames,
      handler,
      guards: options.guards ?? [],
      title: options.title,
    });
  }

  setNotFound(handler: RouteHandler): void {
    this.notFoundHandler = handler;
  }

  navigate(path: string, replace = false): void {
    if (replace) {
      window.location.replace(`#${path}`);
    } else {
      window.location.hash = path;
    }
  }

  getPath(): string {
    const hash = window.location.hash.slice(1) || '/';
    return hash || '/';
  }

  start(): void {
    window.addEventListener('hashchange', () => void this.handle());
    void this.handle();
  }

  private async handle(): Promise<void> {
    const fullPath = this.getPath();
    if (fullPath === this.currentPath) return;
    this.currentPath = fullPath;

    const [pathname, queryString = ''] = fullPath.split('?');
    const query = new URLSearchParams(queryString);
    const cleanPath = pathname ?? '/';

    for (const route of this.routes) {
      const match = cleanPath.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? '');
      });

      const ctx: RouteContext = { path: cleanPath, params, query };

      for (const guard of route.guards) {
        const result = await guard(ctx);
        if (result === false) return;
        if (typeof result === 'string') {
          this.navigate(result, true);
          return;
        }
      }

      if (route.title) {
        document.title = `${route.title} — Улыбка ребёнка`;
      }

      try {
        await route.handler(ctx);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('route handler error', err);
      }
      return;
    }

    if (this.notFoundHandler) {
      await this.notFoundHandler({ path: cleanPath, params: {}, query });
    }
  }

  reload(): void {
    const saved = this.currentPath;
    this.currentPath = null;
    if (saved) {
      window.location.hash = saved;
    }
    void this.handle();
  }
}

export const router = new Router();