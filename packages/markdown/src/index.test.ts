import {
  parseMarkdown,
  parseHtml,
  mdGroupImageGrid,
  MdMediaRewriteOptions,
  mdRewriteLinkUrls,
  mdRewriteMediaUrls,
  mdFindFeatured,
  mdFilterForFeatured,
  mdCutOff,
  mdRenderText,
  mdRenderHtml,
  mdRenderMarkdown,
  mdSeparateTitle,
  serializeMdNodes,
  deserializeMdNodes,
} from "./index";

function stripPos<T>(val: T): T {
  if (Array.isArray(val)) return val.map(stripPos) as unknown as T;
  if (val && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === "charPosition" || k === "linePosition") continue;
      out[k] = stripPos(v);
    }
    return out as T;
  }
  return val;
}

function makeText(mdText: string) {
  const nodes = parseMarkdown(mdText);
  return mdRenderText(nodes);
}

function makeHtml(mdText: string, usePosAttrs = false) {
  const nodes = parseMarkdown(mdText);
  return mdRenderHtml(nodes, usePosAttrs);
}

function makeMarkdown(mdText: string) {
  const nodes = parseMarkdown(mdText);
  return mdRenderMarkdown(nodes);
}

function makeMarkdownFromHtml(html: string) {
  const nodes = parseHtml(html);
  return mdRenderMarkdown(nodes);
}

describe("parseMarkdown", () => {
  it("empty body", () => {
    const mdText = "";
    expect(parseMarkdown(mdText)).toStrictEqual([]);
  });

  it("paragraph", () => {
    const mdText = "hello world";
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "hello world",
          },
        ],
      },
    ];
    expect(stripPos(parseMarkdown(mdText))).toStrictEqual(expected);
  });

  it("list", () => {
    const mdText = "- hello world\n- me too";
    const expected = [
      {
        type: "element",
        tag: "ul",
        children: [
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "hello world",
              },
            ],
          },
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "me too",
              },
            ],
          },
        ],
      },
    ];
    expect(stripPos(parseMarkdown(mdText))).toStrictEqual(expected);
  });

  it("comments", () => {
    const mdText = "one\n<[uno]>\ntwo<[dos]>three\n- four\n<[tres]>\n- five\n";
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "one",
          },
          {
            type: "element",
            tag: "br",
            children: [],
          },
          {
            type: "text",
            text: "two",
          },
          {
            type: "text",
            text: "three",
          },
        ],
      },
      {
        type: "element",
        tag: "ul",
        children: [
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "four",
              },
            ],
          },
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "five",
              },
            ],
          },
        ],
      },
    ];
    expect(stripPos(parseMarkdown(mdText))).toStrictEqual(expected);
  });
});

describe("mdGroupImageGrid", () => {
  it("single", () => {
    const mdText = "![img1](/data/logo1.jpg){grid}";
    const expected = [
      {
        type: "element",
        tag: "div",
        attrs: {
          class: "image-grid",
          "data-cols": 1,
        },
        children: [
          {
            type: "element",
            tag: "figure",
            attrs: {
              class: "image-block",
            },
            children: [
              {
                type: "element",
                tag: "img",
                attrs: {
                  src: "/data/logo1.jpg",
                  grid: true,
                },
                children: [],
              },
              {
                type: "element",
                tag: "figcaption",
                children: [
                  {
                    type: "text",
                    text: "img1",
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(stripPos(mdGroupImageGrid(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });

  it("double", () => {
    const mdText = `![img1](/data/logo1.jpg){grid}
![img2](/data/logo2.jpg){grid}`;
    const expected = [
      {
        type: "element",
        tag: "div",
        attrs: {
          class: "image-grid",
          "data-cols": 2,
        },
        children: [
          {
            type: "element",
            tag: "figure",
            attrs: {
              class: "image-block",
            },
            children: [
              {
                type: "element",
                tag: "img",
                attrs: {
                  src: "/data/logo1.jpg",
                  grid: true,
                },
                children: [],
              },
              {
                type: "element",
                tag: "figcaption",
                children: [
                  {
                    type: "text",
                    text: "img1",
                  },
                ],
              },
            ],
          },
          {
            type: "element",
            tag: "figure",
            attrs: {
              class: "image-block",
            },
            children: [
              {
                type: "element",
                tag: "img",
                attrs: {
                  src: "/data/logo2.jpg",
                  grid: true,
                },
                children: [],
              },
              {
                type: "element",
                tag: "figcaption",
                children: [
                  {
                    type: "text",
                    text: "img2",
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(stripPos(mdGroupImageGrid(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });
});

describe("parseHtml", () => {
  it("empty body", () => {
    const html = "";
    expect(parseHtml(html)).toStrictEqual([]);
  });

  it("plaintext", () => {
    const html = "abc";
    expect(parseHtml(html)).toStrictEqual([
      {
        children: [
          {
            text: "abc",
            type: "text",
          },
        ],
        tag: "p",
        type: "element",
      },
    ]);
  });

  it("plaintext", () => {
    const html = "abc";
    expect(parseHtml(html)).toStrictEqual([
      {
        children: [
          {
            text: "abc",
            type: "text",
          },
        ],
        tag: "p",
        type: "element",
      },
    ]);
  });

  it("paragraph", () => {
    const html = "<p>abc</p>";
    expect(parseHtml(html)).toStrictEqual([
      {
        children: [
          {
            text: "abc",
            type: "text",
          },
        ],
        tag: "p",
        type: "element",
      },
    ]);
  });

  it("list", () => {
    const html = `<ul>
<li>one</li>
<li>two</li>
</ul>`;
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "ul",
        children: [
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "one",
              },
            ],
          },
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "two",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("table", () => {
    const html = `<table><tr>
<td>one</td><td>two</td>
</tr></table>`;
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "table",
        children: [
          {
            type: "element",
            tag: "tr",
            children: [
              {
                type: "element",
                tag: "td",
                children: [
                  {
                    type: "text",
                    text: "one",
                  },
                ],
              },
              {
                type: "element",
                tag: "td",
                children: [
                  {
                    type: "text",
                    text: "two",
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("body only", () => {
    const html = `<html>
<head>
<title>hoge</title>
</head>
<body>
abc
</body>
</html>`;
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
    ]);
  });

  it("inline basics", () => {
    const html =
      '<b>bold</b><ruby><rb>ruby</rb><rt>RUBY</rt></ruby><a href="/foo.html">link</a>';
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "strong",
            children: [
              {
                type: "text",
                text: "bold",
              },
            ],
          },
          {
            type: "element",
            tag: "ruby",
            children: [
              {
                type: "element",
                tag: "rb",
                children: [
                  {
                    type: "text",
                    text: "ruby",
                  },
                ],
              },
              {
                type: "element",
                tag: "rt",
                children: [
                  {
                    type: "text",
                    text: "RUBY",
                  },
                ],
              },
            ],
          },
          {
            type: "element",
            tag: "a",
            children: [
              {
                type: "text",
                text: "link",
              },
            ],
            attrs: {
              href: "/foo.html",
            },
          },
        ],
      },
    ]);
  });

  it("broken tags", () => {
    const html =
      '<b>bold<b><ruby><rb>ruby</rb><rt>RUBY</rt><a href="/foo.html">link</a>';
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "strong",
            children: [
              {
                type: "text",
                text: "bold",
              },
              {
                type: "element",
                tag: "ruby",
                children: [
                  {
                    type: "element",
                    tag: "rb",
                    children: [
                      {
                        type: "text",
                        text: "ruby",
                      },
                    ],
                  },
                  {
                    type: "element",
                    tag: "rt",
                    children: [
                      {
                        type: "text",
                        text: "RUBY",
                      },
                    ],
                  },
                ],
              },
              {
                type: "text",
                text: "link",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("inline wrapping blocks", () => {
    const html = "<b><p>abc</p><ul><li>def</li></ul></b>";
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "strong",
            children: [
              {
                type: "text",
                text: "abcdef",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("headers", () => {
    const html = "<div><h1>h1</h1><h2>h2</h2><h6>h6</h6></div>";
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "h1",
        children: [
          {
            type: "text",
            text: "h1",
          },
        ],
      },
      {
        type: "element",
        tag: "h2",
        children: [
          {
            type: "text",
            text: "h2",
          },
        ],
      },
      {
        type: "element",
        tag: "h6",
        children: [
          {
            type: "text",
            text: "h6",
          },
        ],
      },
    ]);
  });

  it("blockquote", () => {
    const html =
      "<div><blockquote><p><blockquote>abc</blockquote></p></blockquote></div>";
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "blockquote",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
    ]);
  });

  it("image", () => {
    const html = ' ab <b>cd</b> <img src="/foo.png" alt="img"/> <i>ef</i> gh ';
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "ab ",
          },
          {
            type: "element",
            tag: "strong",
            children: [
              {
                type: "text",
                text: "cd",
              },
            ],
          },
        ],
      },
      {
        type: "element",
        tag: "figure",
        children: [
          {
            type: "element",
            tag: "img",
            children: [],
            attrs: {
              src: "/foo.png",
              alt: "img",
            },
          },
        ],
        attrs: {
          class: "image-block",
        },
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "em",
            children: [
              {
                type: "text",
                text: "ef",
              },
            ],
          },
          {
            type: "text",
            text: " gh",
          },
        ],
      },
    ]);
  });

  it("empty elements", () => {
    const html = "<p></p> a <b></b> b <ul></ul> c <div></div>A <i>B  C</i> D";
    expect(parseHtml(html)).toStrictEqual([
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "a b",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "c",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "A ",
          },
          {
            type: "element",
            tag: "em",
            children: [
              {
                type: "text",
                text: "B C",
              },
            ],
          },
          {
            type: "text",
            text: " D",
          },
        ],
      },
    ]);
  });
});

describe("mdRewriteLinkUrls", () => {
  it("rewrites http to https", () => {
    const mdText = "[link](http://example.com/path)";
    const rules = [{ pattern: /^http:\/\//, replacement: "https://" }];
    const nodes = parseMarkdown(mdText);
    const rewritten = mdRewriteLinkUrls(nodes, rules);
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "a",
            attrs: { href: "https://example.com/path" },
            children: [{ type: "text", text: "link" }],
          },
        ],
      },
    ];
    expect(stripPos(rewritten)).toStrictEqual(expected);
  });

  it("rewrites relative to absolute", () => {
    const mdText = "[home](/posts) and [user](/users/123)";
    const rules = [
      { pattern: /^\/(posts|users)/, replacement: "https://stgy.jp/$1" },
    ];
    const nodes = parseMarkdown(mdText);
    const rewritten = mdRewriteLinkUrls(nodes, rules);
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "element",
            tag: "a",
            attrs: { href: "https://stgy.jp/posts" },
            children: [{ type: "text", text: "home" }],
          },
          {
            type: "text",
            text: " and ",
          },
          {
            type: "element",
            tag: "a",
            attrs: { href: "https://stgy.jp/users/123" },
            children: [{ type: "text", text: "user" }],
          },
        ],
      },
    ];
    expect(stripPos(rewritten)).toStrictEqual(expected);
  });

  it("keeps others as is", () => {
    const mdText = "[nochange](mailto:info@example.com)";
    const rules = [{ pattern: /^\/foo/, replacement: "/bar" }];
    const nodes = parseMarkdown(mdText);
    const rewritten = mdRewriteLinkUrls(nodes, rules);
    expect(stripPos(rewritten)).toStrictEqual(stripPos(nodes));
  });

  it("rewrites nested links", () => {
    const mdText = "> see [doc](/docs)";
    const rules = [{ pattern: /^\/docs/, replacement: "https://docs.stgy.jp" }];
    const nodes = parseMarkdown(mdText);
    const rewritten = mdRewriteLinkUrls(nodes, rules);
    const expected = [
      {
        type: "element",
        tag: "blockquote",
        children: [
          {
            type: "text",
            text: "see ",
          },
          {
            type: "element",
            tag: "a",
            attrs: { href: "https://docs.stgy.jp" },
            children: [{ type: "text", text: "doc" }],
          },
        ],
      },
    ];
    expect(stripPos(rewritten)).toStrictEqual(expected);
  });
});

describe("mdRewriteMediaUrls", () => {
  const rewriteOptions: MdMediaRewriteOptions = {
    allowedPatterns: [/^\/(data)/],
    alternativeImage: "/data/missing.jpg",
    rewriteRules: [{ pattern: /\.jpg$/, replacement: ".png" }],
  };

  it("missing", () => {
    const mdText = "![img](http://stgy.jp/logo.jpg)";
    const expected = [
      {
        type: "element",
        tag: "figure",
        attrs: {
          class: "image-block",
        },
        children: [
          {
            type: "element",
            tag: "img",
            attrs: {
              src: "/data/missing.jpg",
            },
            children: [],
          },
          {
            type: "element",
            tag: "figcaption",
            children: [
              {
                type: "text",
                text: "img",
              },
            ],
          },
        ],
      },
    ];
    expect(
      stripPos(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions)),
    ).toStrictEqual(expected);
  });

  it("replace", () => {
    const mdText = "![img](/data/logo.jpg)";
    const expected = [
      {
        type: "element",
        tag: "figure",
        attrs: {
          class: "image-block",
        },
        children: [
          {
            type: "element",
            tag: "img",
            attrs: {
              src: "/data/logo.png",
            },
            children: [],
          },
          {
            type: "element",
            tag: "figcaption",
            children: [
              {
                type: "text",
                text: "img",
              },
            ],
          },
        ],
      },
    ];
    expect(
      stripPos(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions)),
    ).toStrictEqual(expected);
  });
});

describe("mdFindFeatured", () => {
  it("pickup none", () => {
    const mdText = "hello\nworld\n";
    expect(mdFindFeatured(parseMarkdown(mdText))).toBeNull();
  });

  it("pickup the first image", () => {
    const mdText = `abc
![alt](/data/first.jpg)
def
![alt](/data/second.jpg)
`;
    const expected = {
      type: "element",
      tag: "figure",
      attrs: {
        class: "image-block",
      },
      children: [
        {
          type: "element",
          tag: "img",
          attrs: {
            src: "/data/first.jpg",
          },
          children: [],
        },
        {
          type: "element",
          tag: "figcaption",
          children: [
            {
              type: "text",
              text: "alt",
            },
          ],
        },
      ],
    };
    expect(stripPos(mdFindFeatured(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });

  it("pickup a tagged image", () => {
    const mdText = `abc
![alt](/data/first.jpg)
def
![alt](/data/second.jpg){featured}
`;
    const expected = {
      type: "element",
      tag: "figure",
      attrs: {
        class: "image-block",
      },
      children: [
        {
          type: "element",
          tag: "img",
          attrs: {
            featured: true,
            src: "/data/second.jpg",
          },
          children: [],
        },
        {
          type: "element",
          tag: "figcaption",
          children: [
            {
              type: "text",
              text: "alt",
            },
          ],
        },
      ],
    };
    expect(stripPos(mdFindFeatured(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });
});

describe("mdFilterForFeatured", () => {
  it("pickup the first image", () => {
    const mdText = `abc
![alt](/data/first.jpg)
def
![alt](/data/second.jpg)
`;
    const expected = [
      {
        type: "element",
        tag: "figure",
        attrs: {
          class: "featured-block",
        },
        children: [
          {
            type: "element",
            tag: "img",
            attrs: {
              src: "/data/first.jpg",
            },
            children: [],
          },
          {
            type: "element",
            tag: "figcaption",
            children: [
              {
                type: "text",
                text: "alt",
              },
            ],
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "def",
          },
        ],
      },
    ];
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });

  it("pickup a tagged image", () => {
    const mdText = `abc
![alt](/data/first.jpg)
def
![alt](/data/second.jpg){featured}
`;
    const expected = [
      {
        type: "element",
        tag: "figure",
        attrs: {
          class: "featured-block",
        },
        children: [
          {
            type: "element",
            tag: "img",
            attrs: {
              src: "/data/second.jpg",
              featured: true,
            },
            children: [],
          },
          {
            type: "element",
            tag: "figcaption",
            children: [
              {
                type: "text",
                text: "alt",
              },
            ],
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "def",
          },
        ],
      },
    ];
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });

  it("pickup no image", () => {
    const mdText = `abc
![alt](/data/first.jpg){no-featured}
def
![alt](/data/second.jpg){no-featured}
`;
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "def",
          },
        ],
      },
    ];
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(
      expected,
    );
  });
});

describe("mdCutOff", () => {
  it("mdCutOff by length", () => {
    const mdText = "- hello world\n- me too";
    const expected = [
      {
        type: "element",
        tag: "ul",
        children: [
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "hello…",
              },
              {
                type: "element",
                tag: "omitted",
                children: [],
              },
            ],
          },
        ],
      },
    ];
    expect(
      stripPos(mdCutOff(parseMarkdown(mdText), { maxLen: 5 })),
    ).toStrictEqual(expected);
  });

  it("mdCutOff by height", () => {
    const mdText = "- hello world\n- me too";
    const expected = [
      {
        type: "element",
        tag: "ul",
        children: [
          {
            type: "element",
            tag: "li",
            children: [
              {
                type: "text",
                text: "hello world",
              },
            ],
          },
          {
            type: "element",
            tag: "omitted",
            children: [],
          },
        ],
      },
    ];
    expect(
      stripPos(mdCutOff(parseMarkdown(mdText), { maxHeight: 1 })),
    ).toStrictEqual(expected);
  });

  it("toc", () => {
    const mdText = "abc\n<!TOC!>\ndef";
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "abc",
          },
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "def",
          },
        ],
      },
    ];
    expect(
      stripPos(mdCutOff(parseMarkdown(mdText), { maxLen: 100 })),
    ).toStrictEqual(expected);
  });
});

describe("mdRenderText basics", () => {
  it("empty body", () => {
    const mdText = "";
    expect(makeText(mdText)).toBe("");
  });

  it("paragraph", () => {
    const mdText = "hello world";
    expect(makeText(mdText)).toBe("hello world");
  });

  it("header 1", () => {
    const mdText = "# hello world";
    expect(makeText(mdText)).toBe("hello world");
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(makeText(mdText)).toBe("hello world");
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(makeText(mdText)).toBe("hello world");
  });

  it("header 6", () => {
    const mdText = "###### hello world";
    expect(makeText(mdText)).toBe("hello world");
  });

  it("list", () => {
    const mdText = "- hello world";
    expect(makeText(mdText)).toBe("- hello world");
  });

  it("table", () => {
    const mdText = "|=a=|>>b|\n|=c=|><d|={colspan=2}{rowspan=3}e=|";
    expect(makeText(mdText)).toBe("|a|b|\n|c|d|e|");
  });

  it("image", () => {
    const mdText = "![tako](/data/tako.jpg)";
    expect(makeText(mdText)).toBe("tako");
  });

  it("inline basics", () => {
    const mdText =
      "**bold** ::italic:: __underline__ ~~strike~~ ``code`` @@mark@@ %%small%%";
    expect(makeText(mdText)).toBe(
      "bold italic underline strike code mark small",
    );
  });

  it("ruby", () => {
    const mdText = "{{base|ruby}} {{123 456|hop step}}";
    expect(makeText(mdText)).toBe("base(ruby) 123 456(hop step)");
  });

  it("math", () => {
    const mdText = "$$E = mc^2$$ $$\\sum_{i=1}^{\\sqrt{n}}$$";
    expect(makeText(mdText)).toBe("E = mc^2 \\sum_{i=1}^{\\sqrt{n}}");
  });

  it("links", () => {
    const mdText = "[gold](http://gold.com/) [silver](/silver.html)";
    expect(makeText(mdText)).toBe("gold silver");
  });

  it("toc", () => {
    const mdText = "abc\n<!TOC!>\ndef";
    expect(makeText(mdText)).toBe("abc\n\ndef");
  });
});

describe("mdRenderHtml basics", () => {
  it("empty body", () => {
    const mdText = "";
    expect(makeHtml(mdText)).toBe("");
  });

  it("paragraph", () => {
    const mdText = "hello world";
    expect(makeHtml(mdText)).toBe("<p>hello world</p>");
  });

  it("header 1", () => {
    const mdText = "# hello world";
    expect(makeHtml(mdText)).toBe('<h1 id="h-1">hello world</h1>');
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(makeHtml(mdText)).toBe('<h2 id="h-0-1">hello world</h2>');
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(makeHtml(mdText)).toBe('<h3 id="h-0-0-1">hello world</h3>');
  });

  it("header 6", () => {
    const mdText = "###### hello world";
    expect(makeHtml(mdText)).toBe('<h6 id="h-0-0-0-0-0-1">hello world</h6>');
  });

  it("escape characters", () => {
    const mdText = "<h1>John's & House</h1>";
    expect(makeHtml(mdText)).toBe(
      "<p>&lt;h1&gt;John&#39;s &amp; House&lt;/h1&gt;</p>",
    );
  });

  it("list", () => {
    const mdText = "- hello world";
    expect(makeHtml(mdText)).toBe("<ul><li>hello world</li></ul>");
  });

  it("list number", () => {
    const mdText = "-+ hello world\n  -: second\n-+ love";
    expect(makeHtml(mdText)).toBe(
      '<ul data-bullet="number"><li>hello world<ul data-bullet="none"><li>second</li></ul></li><li>love</li></ul>',
    );
  });

  it("table", () => {
    const mdText = "|=text=|hello world|>>a|=><b=|{colspan=2}{rowspan=3}c|";
    expect(makeHtml(mdText)).toBe(
      '<table><tr><th>text</th><td>hello world</td><td class="align-right">a</td><th class="align-center">b</th><td colspan="2" rowspan="3">c</td></tr></table>',
    );
  });

  it("image", () => {
    const mdText = "![tako](/data/tako.jpg)";
    expect(makeHtml(mdText)).toBe(
      '<figure class="image-block"><img src="/data/tako.jpg" alt="" decoding="async" loading="lazy"><figcaption>tako</figcaption></figure>',
    );
  });

  it("video", () => {
    const mdText = "![tako](/data/tako.mp4){autoplay}";
    expect(makeHtml(mdText)).toBe(
      '<figure class="image-block" data-autoplay><video src="/data/tako.mp4" aria-label="" controls></video><figcaption>tako</figcaption></figure>',
    );
  });

  it("quote", () => {
    const mdText = "> hello world";
    expect(makeHtml(mdText)).toBe("<blockquote>hello world</blockquote>");
  });

  it("decorations", () => {
    const mdText =
      "**strong** ::em:: __underline__ ~~strike~~ ``code`` @@mark@@ %%small%%";
    expect(makeHtml(mdText)).toBe(
      "<p><strong>strong</strong> <em>em</em> <u>underline</u> <s>strike</s> <code>code</code> <mark>mark</mark> <small>small</small></p>",
    );
  });

  it("ruby", () => {
    const mdText = "{{tako|ika}} {{uni **ebi**|<ikura>}}";
    expect(makeHtml(mdText)).toBe(
      "<p><ruby><rb>tako</rb><rt>ika</rt></ruby> <ruby><rb>uni <strong>ebi</strong></rb><rt>&lt;ikura&gt;</rt></ruby></p>",
    );
  });

  it("math", () => {
    const mdText = "$$E = mc^2$$ $$\\sum_{i=1}^{\\sqrt{n}}$$";
    expect(makeHtml(mdText)).toBe(
      '<p><code class="math-inline">E = mc^2</code> <code class="math-inline">\\sum_{i=1}^{\\sqrt{n}}</code></p>',
    );
  });

  it("links", () => {
    const mdText = "[tako](tako.html) http://example.com/ika?uni=ebi#time";
    expect(makeHtml(mdText)).toBe(
      '<p>[tako](tako.html) <a href="http://example.com/ika?uni=ebi#time">http://example.com/ika?uni=ebi#time</a></p>',
    );
  });

  it("escape", () => {
    const mdText =
      "\\::a:\\: \\*\\*b\\*\\* \\__c_\\_ \\~~d~\\~ \\``e`\\` \\\\123 \\A\\0";
    expect(makeHtml(mdText)).toBe(
      "<p>::a:: **b** __c__ ~~d~~ ``e`` \\123 \\A\\0</p>",
    );
  });

  it("toc", () => {
    const mdText = "# h1\n<!TOC!>\n## h2\n### h3\n### h3\n## h2\n";
    expect(makeHtml(mdText)).toBe(
      '<h1 id="h-1">h1</h1><nav aria-label="table of contents" class="toc"><ul><li><a href="#h-1-1">h2</a><ul><li><a href="#h-1-1-1">h3</a></li><li><a href="#h-1-1-2">h3</a></li></ul></li><li><a href="#h-1-2">h2</a></li></ul></nav><h2 id="h-1-1">h2</h2><h3 id="h-1-1-1">h3</h3><h3 id="h-1-1-2">h3</h3><h2 id="h-1-2">h2</h2>',
    );
  });
});

describe("mdRenderHtml positions", () => {
  it("adds data-* to paragraph", () => {
    const html = makeHtml("hello world", true);
    expect(html).toContain('<p data-char-position="0" data-line-position="0">');
  });

  it("adds data-* to list/li", () => {
    const html = makeHtml("- a\n- b", true);
    expect(html).toMatch(
      /<ul[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
    expect(html).toMatch(/<li[^>]*data-line-position="0"/);
    expect(html).toMatch(/<li[^>]*data-line-position="1"/);
  });

  it("adds data-* to table and cells", () => {
    const html = makeHtml("|hello world|", true);
    expect(html).toMatch(
      /<table[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
    expect(html).toMatch(/<tr[^>]*data-line-position="0"/);
    expect(html).toMatch(/<td[^>]*data-line-position="0"/);
  });

  it("adds data-* to figure & media", () => {
    const imgHtml = makeHtml("![tako](/data/tako.jpg)", true);
    expect(imgHtml).toMatch(
      /<figure[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
    expect(imgHtml).toMatch(
      /<img[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );

    const vidHtml = makeHtml("![tako](/data/tako.mp4){autoplay}", true);
    expect(vidHtml).toMatch(
      /<figure[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
    expect(vidHtml).toMatch(
      /<video[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
  });

  it("adds data-* to blockquote", () => {
    const html = makeHtml("> hello", true);
    expect(html).toMatch(
      /<blockquote[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
  });

  it("adds data-* to pre", () => {
    const md = "```\ncode\n```";
    const html = makeHtml(md, true);
    expect(html).toMatch(
      /<pre[^>]*data-char-position="0"[^>]*data-line-position="0"/,
    );
  });
});

describe("mdRenderHtml advanced", () => {
  it("various formats", () => {
    const mdText = `# H1
abc
def

xyz
\`\`\`\`xml:small
<a>tako</a>
ika
\`\`\`\`
## H2
- a
b
- c
  - d
    - e
  - f
- g
- h
  - j
    - k
abc
|::a::|b|
|c|**d**|
![abc](/data/def/ghi){thumbnail}
### H3
`;
    const expected = `<h1 id="h-1">H1</h1><p>abc<br>def</p><p>xyz</p><pre data-pre-mode="xml" data-pre-style="small">&lt;a&gt;tako&lt;/a&gt;
ika</pre><h2 id="h-1-1">H2</h2><ul><li>a</li></ul><p>b</p><ul><li>c<ul><li>d<ul><li>e</li></ul></li><li>f</li></ul></li><li>g</li><li>h<ul><li>j<ul><li>k</li></ul></li></ul></li></ul><p>abc</p><table><tr><td><em>a</em></td><td>b</td></tr><tr><td>c</td><td><strong>d</strong></td></tr></table><figure class="image-block" data-thumbnail><img src="/data/def/ghi" alt="" decoding="async" loading="lazy"><figcaption>abc</figcaption></figure><h3 id="h-1-1-1">H3</h3>`;
    expect(makeHtml(mdText)).toBe(expected);
  });
});

describe("mdRenderMarkdown basics", () => {
  it("empty body", () => {
    const mdText = "";
    expect(makeMarkdown(mdText)).toBe("");
  });

  it("paragraph", () => {
    const mdText = "hello world";
    expect(makeMarkdown(mdText)).toBe("hello world\n");
  });

  it("header 1", () => {
    const mdText = "# hello world";
    expect(makeMarkdown(mdText)).toBe("# hello world\n");
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(makeMarkdown(mdText)).toBe("## hello world\n");
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(makeMarkdown(mdText)).toBe("### hello world\n");
  });

  it("header 6", () => {
    const mdText = "###### hello world";
    expect(makeMarkdown(mdText)).toBe("###### hello world\n");
  });
  it("list", () => {
    const mdText = "- hello world";
    expect(makeMarkdown(mdText)).toBe("- hello world\n");
  });

  it("list number", () => {
    const mdText = "-+ hello world\n  -: second\n-+ love";
    expect(makeMarkdown(mdText)).toBe("-+ hello world\n  -: second\n-+ love\n");
  });

  it("table", () => {
    const mdText = "|=text=|hello world|>>a|=><b=|{colspan=2}{rowspan=3}c|";
    expect(makeMarkdown(mdText)).toBe(
      "|=text=|hello world|>>a|=><b=|{colspan=2}{rowspan=3}c|\n",
    );
  });

  it("image", () => {
    const mdText = "![tako](/data/tako.jpg)";
    expect(makeMarkdown(mdText)).toBe("![tako](/data/tako.jpg)\n");
  });

  it("video", () => {
    const mdText = "![tako](/data/tako.mp4){autoplay}";
    expect(makeMarkdown(mdText)).toBe("![tako](/data/tako.mp4){autoplay}\n");
  });

  it("quote", () => {
    const mdText = "> hello world";
    expect(makeMarkdown(mdText)).toBe("> hello world\n");
  });

  it("decorations", () => {
    const mdText =
      "**strong** ::em:: __underline__ ~~strike~~ ``code`` @@mark@@ %%small%%";
    expect(makeMarkdown(mdText)).toBe(
      "**strong** ::em:: __underline__ ~~strike~~ ``code`` @@mark@@ %%small%%\n",
    );
  });

  it("ruby", () => {
    const mdText = "{{tako|ika}} {{uni **ebi**|<ikura>}}";
    expect(makeMarkdown(mdText)).toBe("{{tako|ika}} {{uni ebi|<ikura>}}\n");
  });

  it("math", () => {
    const mdText = "$$E = mc^2$$ $$\\sum_{i=1}^{\\sqrt{n}}$$";
    expect(makeMarkdown(mdText)).toBe(
      "$$E = mc^2$$ $$\\sum_{i=1}^{\\sqrt{n}}$$\n",
    );
  });

  it("links", () => {
    const mdText = "[tako](tako.html) http://example.com/ika?uni=ebi#time";
    expect(makeMarkdown(mdText)).toBe(
      "[tako](tako.html) http://example.com/ika?uni=ebi#time\n",
    );
  });

  it("nested", () => {
    const mdText = "- **::__tako__::**";
    expect(makeMarkdown(mdText)).toBe("- **::__tako__::**\n");
  });

  it("structures", () => {
    const mdText = "abc\n- one\n  - two\n### **three**\n|four|::five::|\n";
    expect(makeMarkdown(mdText)).toBe(
      "abc\n\n- one\n  - two\n\n### **three**\n\n|four|::five::|\n",
    );
  });
});

describe("mdRenderMarkdown from HTML", () => {
  it("inline variations", () => {
    const html = `<span>normal</span>
<strong>bold1</strong>
<b>bold2</b>
<span style="font-weight: bold;">bold3</span>
<em>italic1</em>
<i>italic2</i>
<span style="font-style: italic;">italic3</span>
<u>underline1</u>
<span style="text-decoration: underline;">underline2</span>
<s>strike1</s>
<del>strike2</del>
<span style="text-decoration: line-through;">strike3</span>
<code>code1</code>
<kbd>code2</kbd>
<span style="font-family: monospace;">code3</span>
<mark>mark1</mark>
<span style="background-color:#ff0;">mark2</span>
<small>small1</small>
<span style="font-size: 8pt;">small2</span>
<ruby><rb>ruby</rb><rt>RUBY</rt></ruby>
`;
    expect(makeMarkdownFromHtml(html)).toBe(
      "normal **bold1** **bold2** **bold3** ::italic1:: ::italic2:: ::italic3:: __underline1__ __underline2__ ~~strike1~~ ~~strike2~~ ~~strike3~~ ``code1`` ``code2`` ``code3`` @@mark1@@ @@mark2@@ %%small1%% %%small2%% {{ruby|RUBY}}\n",
    );
  });

  it("header variations", () => {
    const html = `<body>
<h1>h1 <a href="/foo.html">link</a></h1>
<h2>h2 <u>underline</u></h2>
<h3>h3 <s>strike</s></h3>
<h4>h4 <code>code</code></h4>
<h5>h5 <mark>mark</mark></h5>
<h6>h6 <small>small</small></h6>
</body>
`;
    expect(makeMarkdownFromHtml(html)).toBe(`# h1 [link](/foo.html)

## h2 __underline__

### h3 ~~strike~~

#### h4 \`\`code\`\`

##### h5 @@mark@@

###### h6 %%small%%
`);
  });

  it("list variations", () => {
    const html = `<div>
<ul>
<li>1<ul><li>1-1<ul><li>1-1-1</li></ul></li></ul></li>
<li>2<ul><li>2-1</li></ul></li>
<li>3</li>
</ul>

<ol>
<li>1<li>
<li>2 <b>bold</b><li>
</ol>

<ul style="list-style: none">
<li>1<li>
<li>2 <i>italic</i><li>
</ul>
</div>
`;
    expect(makeMarkdownFromHtml(html)).toBe(`- 1
  - 1-1
    - 1-1-1
- 2
  - 2-1
- 3

-+ 1
-+ 2 **bold**

-: 1
-: 2 ::italic::
`);
  });

  it("blockquote variations", () => {
    const html = `<blockquote>one<br>two</blockquote>
`;
    expect(makeMarkdownFromHtml(html)).toBe(`> one
> two
`);
  });

  it("table variations", () => {
    const html = `<table><tbody>
<tr><th style="text-align:center;">one</th><th style="text-align:right;">two</th></tr>
<tr><td><b>three</b></td><td><i>four</i></td></tr>
<tr><td colspan="2" rowspan="2">five</td></tr>
</tbody></table>
`;
    expect(makeMarkdownFromHtml(html)).toBe(`|=><one=|=>>two=|
|**three**|::four::|
|{colspan=2}{rowspan=2}five|
`);
  });

  it("pre variations", () => {
    const html = `<pre data-pre-mode="natural" data-pre-style="small">
  one two
  <b>three</b> <i>four</i>
</pre>`;
    expect(makeMarkdownFromHtml(html)).toBe(`\`\`\`natural:small
  one two
  three four
\`\`\`
`);
  });

  it("hr variations", () => {
    const html = `<hr>
<hr data-hr-level="2">
<hr data-hr-level="3">
`;
    expect(makeMarkdownFromHtml(html)).toBe(`---

----

-----
`);
  });

  it("image variations", () => {
    const html = `<img src="/foo1.png" alt="alt1">
<div>abc<img src="/foo2.png" alt="alt2">def</div>
`;
    expect(makeMarkdownFromHtml(html)).toBe(`![alt1](/foo1.png)

abc

![alt2](/foo2.png)

def
`);
  });
});

describe("mdSeparateTitle", () => {
  it("returns first h1", () => {
    const md = "intro\n## H2\n# Title **H1-1**\n# Title H1-2\nbody";
    const { title, otherNodes } = mdSeparateTitle(parseMarkdown(md));
    expect(title).toBe("Title H1-1");
    expect(mdRenderHtml(otherNodes)).toBe(
      '<p>intro</p><h2 id="h-0-1">H2</h2><h1 id="h-1">Title H1-2</h1><p>body</p>',
    );
  });

  it("returns first h2 when no h1", () => {
    const md = "intro\n### H3\n## Title ::H2-1::\n## Title H2-2\nbody";
    const { title, otherNodes } = mdSeparateTitle(parseMarkdown(md));
    expect(title).toBe("Title H2-1");
    expect(mdRenderHtml(otherNodes)).toBe(
      '<p>intro</p><h3 id="h-0-0-1">H3</h3><h2 id="h-0-1">Title H2-2</h2><p>body</p>',
    );
  });

  it("returns null when no h1/h2", () => {
    const md = "intro\n### Only H3\nbody";
    const { title, otherNodes } = mdSeparateTitle(parseMarkdown(md));
    expect(title).toBeNull();
    expect(mdRenderHtml(otherNodes)).toBe(
      '<p>intro</p><h3 id="h-0-0-1">Only H3</h3><p>body</p>',
    );
  });
});

describe("serialization", () => {
  it("empty body", () => {
    const mdText = "";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });

  it("paragraph", () => {
    const mdText = "hello world";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe('[{"T":"p","X":"hello world"}]');
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });

  it("list", () => {
    const mdText = "- hello world\n- me too";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"ul","C":[{"T":"li","X":"hello world"},{"T":"li","X":"me too"}]}]',
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });

  it("list number", () => {
    const mdText = "-+ hello world\n-+ me too";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"ul","C":[{"T":"li","X":"hello world"},{"T":"li","X":"me too"}],"BT":"number"}]',
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });

  it("grid", () => {
    const mdText = `![img1](/data/img1.jpg){grid}
![img2](/data/img2.jpg){grid}

![img3](/data/img3.jpg){grid}`;
    const nodes = mdGroupImageGrid(parseMarkdown(mdText));
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"div","C":[{"T":"figure","C":[{"T":"img","SR":"/data/img1.jpg","GD":true},{"T":"figcaption","X":"img1"}],"CL":"image-block"},{"T":"figure","C":[{"T":"img","SR":"/data/img2.jpg","GD":true},{"T":"figcaption","X":"img2"}],"CL":"image-block"}],"CL":"image-grid","DC":2},{"T":"div","C":[{"T":"figure","C":[{"T":"img","SR":"/data/img3.jpg","GD":true},{"T":"figcaption","X":"img3"}],"CL":"image-block"}],"CL":"image-grid","DC":1}]',
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });

  it("complex", () => {
    const mdText = `hello world
fetch ::me:: **my** __hat__.
line2

paragraph2
# first
## second
### third
- hop step
- \`\`jump\`\`
|one|two|
![img1](/data/tako.jpg){featured}
![img2](/xyz/tako.jpg){grid}{no-featured}
![video](/data/tako.mp4){grid}
----
> foo bar
> __baz__
> {{abc|def}}
> $$E = mc^2$$
EOF
`;
    let nodes = parseMarkdown(mdText);
    const rewriteOptions: MdMediaRewriteOptions = {
      allowedPatterns: [/^\/(data)/],
      alternativeImage: "/data/missing.jpg",
      rewriteRules: [{ pattern: /\.jpg$/, replacement: ".png" }],
    };
    nodes = mdRewriteMediaUrls(nodes, rewriteOptions);
    nodes = mdGroupImageGrid(nodes);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"p","C":[{"X":"hello world"},{"T":"br"},{"X":"fetch "},{"T":"em","X":"me"},{"X":" "},{"T":"strong","X":"my"},{"X":" "},{"T":"u","X":"hat"},{"X":"."},{"T":"br"},{"X":"line2"}]},{"T":"p","X":"paragraph2"},{"T":"h1","X":"first"},{"T":"h2","X":"second"},{"T":"h3","X":"third"},{"T":"ul","C":[{"T":"li","X":"hop step"},{"T":"li","C":[{"T":"code","X":"jump"}]}]},{"T":"table","C":[{"T":"tr","C":[{"T":"td","X":"one"},{"T":"td","X":"two"}]}]},{"T":"figure","C":[{"T":"img","SR":"/data/tako.png","FE":true},{"T":"figcaption","X":"img1"}],"CL":"image-block"},{"T":"p","C":[{"X":"!"},{"T":"a","X":"img2","HF":"/xyz/tako.jpg"},{"X":"{grid}{no-featured}"}]},{"T":"div","C":[{"T":"figure","C":[{"T":"video","SR":"/data/tako.mp4","GD":true},{"T":"figcaption","X":"video"}],"CL":"image-block"}],"CL":"image-grid","DC":1},{"T":"hr","HL":2},{"T":"blockquote","C":[{"X":"foo bar"},{"T":"br"},{"T":"u","X":"baz"},{"T":"br"},{"T":"ruby","C":[{"T":"rb","X":"abc"},{"T":"rt","X":"def"}]},{"T":"br"},{"T":"math","A":{"tex":"E = mc^2","math-mode":"inline"}}]},{"T":"p","X":"EOF"}]',
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(stripPos(deserialized)).toStrictEqual(stripPos(nodes));
  });
});
