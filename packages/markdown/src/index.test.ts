import {
  parseMarkdown,
  mdGroupImageGrid,
  MdMediaRewriteOptions,
  mdRewriteMediaUrls,
  mdFilterForFeatured,
  mdCutOff,
  mdRenderText,
  mdRenderHtml,
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
    const mdText = "<[[\nuno\ndos\n]]>one\n<[uno]>\ntwo<[dos]>three\n";
    const expected = [
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "one"
          },
          {
            type: "element",
            tag: "br",
            children: []
          },
          {
            type: "text",
            text: "twothree"
          }
        ],
      }
    ]
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
    expect(stripPos(mdGroupImageGrid(parseMarkdown(mdText)))).toStrictEqual(expected);
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
    expect(stripPos(mdGroupImageGrid(parseMarkdown(mdText)))).toStrictEqual(expected);
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
    expect(stripPos(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions))).toStrictEqual(
      expected,
    );
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
    expect(stripPos(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions))).toStrictEqual(
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
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(expected);
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
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(expected);
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
    expect(stripPos(mdFilterForFeatured(parseMarkdown(mdText)))).toStrictEqual(expected);
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
    expect(stripPos(mdCutOff(parseMarkdown(mdText), { maxLen: 5 }))).toStrictEqual(expected);
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
    expect(stripPos(mdCutOff(parseMarkdown(mdText), { maxHeight: 1 }))).toStrictEqual(expected);
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
            text: "abc"
          }
        ],
      },
      {
        type: "element",
        tag: "p",
        children: [
          {
            type: "text",
            text: "def"
          }
        ],
      }
    ];
    expect(stripPos(mdCutOff(parseMarkdown(mdText), { maxLen: 100 }))).toStrictEqual(expected);
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
    const mdText = "**bold** ::italic:: __underline__ ~~strike~~ ``code`` %%mark%%";
    expect(makeText(mdText)).toBe("bold italic underline strike code mark");
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
    expect(makeHtml(mdText)).toBe("<h1 id=\"h-1\">hello world</h1>");
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(makeHtml(mdText)).toBe("<h2 id=\"h-0-1\">hello world</h2>");
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(makeHtml(mdText)).toBe("<h3 id=\"h-0-0-1\">hello world</h3>");
  });

  it("escape characters", () => {
    const mdText = "<h1>John's & House</h1>";
    expect(makeHtml(mdText)).toBe("<p>&lt;h1&gt;John&#39;s &amp; House&lt;/h1&gt;</p>");
  });

  it("list", () => {
    const mdText = "- hello world";
    expect(makeHtml(mdText)).toBe("<ul><li>hello world</li></ul>");
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
    const mdText = "**strong** ::em:: __underline__ ~~strike~~ ``code`` %%mark%%";
    expect(makeHtml(mdText)).toBe(
      "<p><strong>strong</strong> <em>em</em> <u>underline</u> <s>strike</s> <code>code</code> <mark>mark</mark></p>",
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
    const mdText = "\\::a:\\: \\*\\*b\\*\\* \\__c_\\_ \\~~d~\\~ \\``e`\\` \\\\123 \\A\\0";
    expect(makeHtml(mdText)).toBe("<p>::a:: **b** __c__ ~~d~~ ``e`` \\123 \\A\\0</p>");
  });

  it("toc", () => {
    const mdText = "# h1\n<!TOC!>\n## h2\n### h3\n### h2\n";
    expect(makeHtml(mdText)).toBe("<h1 id=\"h-1\">h1</h1><nav aria-label=\"table of contents\" class=\"toc\"><ul><li><a href=\"#h-1-1\">h2</a><ul><li><a href=\"#h-1-1-1\">h3</a></li><li><a href=\"#h-1-1-2\">h2</a></li></ul></li></ul></nav><h2 id=\"h-1-1\">h2</h2><h3 id=\"h-1-1-1\">h3</h3><h3 id=\"h-1-1-2\">h2</h3>");
  });
});

describe("mdRenderHtml positions", () => {
  it("adds data-* to paragraph", () => {
    const html = makeHtml("hello world", true);
    expect(html).toContain('<p data-char-position="0" data-line-position="0">');
  });

  it("adds data-* to list/li", () => {
    const html = makeHtml("- a\n- b", true);
    expect(html).toMatch(/<ul[^>]*data-char-position="0"[^>]*data-line-position="0"/);
    expect(html).toMatch(/<li[^>]*data-line-position="0"/);
    expect(html).toMatch(/<li[^>]*data-line-position="1"/);
  });

  it("adds data-* to table and cells", () => {
    const html = makeHtml("|hello world|", true);
    expect(html).toMatch(/<table[^>]*data-char-position="0"[^>]*data-line-position="0"/);
    expect(html).toMatch(/<tr[^>]*data-line-position="0"/);
    expect(html).toMatch(/<td[^>]*data-line-position="0"/);
  });

  it("adds data-* to figure & media", () => {
    const imgHtml = makeHtml("![tako](/data/tako.jpg)", true);
    expect(imgHtml).toMatch(/<figure[^>]*data-char-position="0"[^>]*data-line-position="0"/);
    expect(imgHtml).toMatch(/<img[^>]*data-char-position="0"[^>]*data-line-position="0"/);

    const vidHtml = makeHtml("![tako](/data/tako.mp4){autoplay}", true);
    expect(vidHtml).toMatch(/<figure[^>]*data-char-position="0"[^>]*data-line-position="0"/);
    expect(vidHtml).toMatch(/<video[^>]*data-char-position="0"[^>]*data-line-position="0"/);
  });

  it("adds data-* to blockquote", () => {
    const html = makeHtml("> hello", true);
    expect(html).toMatch(/<blockquote[^>]*data-char-position="0"[^>]*data-line-position="0"/);
  });

  it("adds data-* to pre", () => {
    const md = "```\ncode\n```";
    const html = makeHtml(md, true);
    expect(html).toMatch(/<pre[^>]*data-char-position="0"[^>]*data-line-position="0"/);
  });
});

describe("mdRenderHtml advanced", () => {
  it("various formats", () => {
    const mdText = `# H1
abc
def

xyz
\`\`\`xml
<a>tako</a>
ika
\`\`\`
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
    const expected = `<h1 id="h-1">H1</h1><p>abc<br>def</p><p>xyz</p><pre data-pre-mode="xml">&lt;a&gt;tako&lt;/a&gt;
ika</pre><h2 id="h-1-1">H2</h2><ul><li>a</li></ul><p>b</p><ul><li>c<ul><li>d<ul><li>e</li></ul></li><li>f</li></ul></li><li>g</li><li>h<ul><li>j<ul><li>k</li></ul></li></ul></li></ul><p>abc</p><table><tr><td><em>a</em></td><td>b</td></tr><tr><td>c</td><td><strong>d</strong></td></tr></table><figure class="image-block" data-thumbnail><img src="/data/def/ghi" alt="" decoding="async" loading="lazy"><figcaption>abc</figcaption></figure><h3 id="h-1-1-1">H3</h3>`;
    expect(makeHtml(mdText)).toBe(expected);
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

  it("grid", () => {
    const mdText = `![img1](/data/img1.jpg){grid}
![img2](/data/img2.jpg){grid}`;
    const nodes = mdGroupImageGrid(parseMarkdown(mdText));
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"div","C":[{"T":"figure","C":[{"T":"img","SR":"/data/img1.jpg","GD":true},{"T":"figcaption","X":"img1"}],"CL":"image-block"},{"T":"figure","C":[{"T":"img","SR":"/data/img2.jpg","GD":true},{"T":"figcaption","X":"img2"}],"CL":"image-block"}],"CL":"image-grid","DC":2}]',
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
