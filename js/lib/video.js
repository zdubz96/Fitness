// "Learn the form" links. We use a YouTube search URL built from the movement name rather than
// a specific video ID: it needs zero curation, never becomes a dead link, and always surfaces
// current, well-ranked form tutorials for that exercise.
export function exerciseVideoUrl(name) {
  if (!name) return null;
  const q = encodeURIComponent(`how to ${name} proper form technique`);
  return `https://www.youtube.com/results?search_query=${q}`;
}
