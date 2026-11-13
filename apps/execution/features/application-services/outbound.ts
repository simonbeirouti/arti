/** Default deny for all generated Worker fetch and socket access. */
export default {
  fetch(): Response { return new Response('Generated service outbound activity is disabled', { status: 403 }); },
};
