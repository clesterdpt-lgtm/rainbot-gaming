const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self'",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
};

function secure(response) {
  const headers = new Headers(response.headers);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => headers.set(name, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);
    const assetUrl = new URL(request.url);

    if (incomingUrl.pathname === "/games/drowned-orrery.html") {
      return secure(Response.redirect(`${incomingUrl.origin}/`, 308));
    }

    if (incomingUrl.pathname === "/") {
      assetUrl.pathname = "/index.html";
    } else if (incomingUrl.pathname.endsWith("/")) {
      assetUrl.pathname += "index.html";
    }

    let response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (response.status === 404 && !assetUrl.pathname.split("/").pop().includes(".")) {
      assetUrl.pathname += ".html";
      response = await env.ASSETS.fetch(new Request(assetUrl, request));
    }

    if (response.status === 404) {
      return secure(
        new Response("THE DROWNED ORRERY // CHART NOT FOUND", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    }

    return secure(response);
  },
};

export default worker;
