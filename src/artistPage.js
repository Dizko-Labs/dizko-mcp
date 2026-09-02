import { getPublicArtistPage } from "./api.js";

// Slim projection of a published artist microsite: only the embed blocks a
// caller can deep-link, never drafts or private builder state. The endpoint
// serves the published payload only; unpublished, unclaimed, or unknown
// handles arrive as 404 -> published:false.
export async function getArtistPage(input = {}, options = {}) {
  const handle = String(input.handle || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(handle)) {
    return {
      published: false,
      handle: handle || null,
      embeds: [],
      error: "Pass an artist handle like AvalonEmerson.",
      error_code: "invalid_artist_handle"
    };
  }

  const page = await getPublicArtistPage(handle, options);
  if (!page) {
    return { published: false, handle, embeds: [] };
  }

  const blocks = Array.isArray(page.page?.blocks) ? page.page.blocks : [];
  const embeds = blocks
    .filter((block) => block && block.type === "embed" && typeof block.id === "string")
    .map((block) => ({
      id: block.id,
      title: String(block.payload?.title || ""),
      provider: String(block.payload?.provider || ""),
      url: String(block.payload?.url || "")
    }));

  return {
    published: true,
    handle,
    slug: typeof page.slug === "string" ? page.slug : null,
    published_at: typeof page.published_at === "string" ? page.published_at : null,
    embeds
  };
}
