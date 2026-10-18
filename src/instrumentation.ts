export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPhotonAgent } = await import("./lib/photonAgent");
    startPhotonAgent();
  }
}
