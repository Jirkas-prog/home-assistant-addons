export function accessGuard(ingress) {
  return (req, res, next) => {
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, "");
    if (ingress && ip !== "172.30.32.2")
      return res.status(403).json({
        error: "Access is only allowed through Home Assistant Ingress.",
      });
    if (!ingress && !["127.0.0.1", "localhost", "[::1]"].includes(req.hostname))
      return res.status(403).json({
        error: "Host is not allowed.",
      });
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.get("X-Knowledge-Client") !== "atlas"
    )
      return res.status(403).json({
        error: "The protection header is missing.",
      });
    if (
      !ingress &&
      req.get("Origin") &&
      ![
        "http://127.0.0.1:8099",
        "http://localhost:8099",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        `http://${req.get("host")}`,
      ].includes(req.get("Origin"))
    )
      return res.status(403).json({
        error: "Request origin is not allowed.",
      });
    res.set("X-Content-Type-Options", "nosniff");
    next();
  };
}
