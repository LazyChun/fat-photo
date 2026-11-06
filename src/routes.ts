/**
 * fat-photo route definitions.
 *
 * Routes are registered with the host (fat-notes) via
 * `sdk.contributions.registerRoutePage()` so the host has visibility into
 * the plugin's pages (for breadcrumbs / global navigation). Navigation is
 * performed through `sdk.router.navigate(path, params)` — the host keeps a
 * single in-memory history stack and notifies subscribers on change.
 *
 * WorkPage subscribes to the router and renders the route page whose path
 * matches `sdk.router.getCurrent().path`.
 */

export const ROUTE_PATHS = {
  HOME: "/photo/home",
} as const;

export type RoutePath = (typeof ROUTE_PATHS)[keyof typeof ROUTE_PATHS];

/** Sidebar menu key → route path. */
export const MENU_ROUTE_MAP: Record<string, string> = {
  home: ROUTE_PATHS.HOME,
};

/**
 * Determine which sidebar menu should be highlighted for a given route
 * path.
 */
export const deriveMenuFromPath = (path: string): string => {
  for (const [menu, route] of Object.entries(MENU_ROUTE_MAP)) {
    if (route === path) return menu;
  }
  return "home";
};

/** Default landing route for the plugin. */
export const DEFAULT_ROUTE = ROUTE_PATHS.HOME;
