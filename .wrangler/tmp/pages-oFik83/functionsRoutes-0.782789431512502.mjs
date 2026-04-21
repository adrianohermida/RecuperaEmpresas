import { onRequest as __api___slug___js_onRequest } from "D:\\Github\\RecuperaEmpresas\\functions\\api\\[[slug]].js"

export const routes = [
    {
      routePath: "/api/:slug*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___slug___js_onRequest],
    },
  ]