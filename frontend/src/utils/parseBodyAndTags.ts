export function parseBodyAndTags(body: string): { content: string; tags: string[] } {
  const lines = body.split(/\r?\n/);
  const forward_lines: string[] = [];
  const forward_tag_lines: string[] = [];
  for (let line of lines) {
    line = line.replace(/\r$/, '').replace(/\s+$/, '');
    if (line) {
      if (forward_lines.length === 0 && line.startsWith("#")) {
        forward_tag_lines.push(line);
      } else {
        forward_lines.push(line);
      }
    } else if (forward_lines.length > 0) {
      forward_lines.push(line);
    }
  }
  const reverse_lines: string[] = [];
  const reverse_tag_lines: string[] = [];
  for (let i = forward_lines.length - 1; i >= 0; --i) {
    const line = forward_lines[i];
    if (line) {
      if (reverse_lines.length === 0 && line.startsWith("#")) {
        reverse_tag_lines.push(line);
      } else {
        reverse_lines.push(line);
      }
    } else if (reverse_lines.length > 0) {
      reverse_lines.push(line);
    }
  }
  const bodyLines = reverse_lines.reverse();
  const tags: string[] = [];
  const unique_tags = new Set<string>();
  const all_tag_lines = forward_tag_lines.concat(reverse_tag_lines.reverse());
  for (let tag_line of all_tag_lines) {
    tag_line = tag_line.replace(/^#/, "");
    for (let tag of tag_line.split(/, *#/g)) {
      tag = tag.replace(/\s+/g, " ").trim();
      if (tag && !unique_tags.has(tag)) {
        tags.push(tag);
        unique_tags.add(tag);
      }
    }
  }
  const content = bodyLines.join("\n");
  return { content, tags };
}
