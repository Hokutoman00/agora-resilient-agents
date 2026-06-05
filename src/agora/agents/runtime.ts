export function shouldUseSimulation(): boolean {
  return process.env.AGORA_FORCE_SIMULATION === '1' || !process.env.TRUEFOUNDRY_API_KEY?.trim();
}
