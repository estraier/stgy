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

function makeText(mdText: string) {
  const nodes = parseMarkdown(mdText);
  return mdRenderText(nodes);
}

function makeHtml(mdText: string) {
  const nodes = parseMarkdown(mdText);
  return mdRenderHtml(nodes);
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
    expect(parseMarkdown(mdText)).toStrictEqual(expected);
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
    expect(parseMarkdown(mdText)).toStrictEqual(expected);
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
    expect(mdGroupImageGrid(parseMarkdown(mdText))).toStrictEqual(expected);
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
    expect(mdGroupImageGrid(parseMarkdown(mdText))).toStrictEqual(expected);
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
    expect(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions)).toStrictEqual(expected);
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
    expect(mdRewriteMediaUrls(parseMarkdown(mdText), rewriteOptions)).toStrictEqual(expected);
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
    expect(mdFilterForFeatured(parseMarkdown(mdText))).toStrictEqual(expected);
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
    expect(mdFilterForFeatured(parseMarkdown(mdText))).toStrictEqual(expected);
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
    expect(mdFilterForFeatured(parseMarkdown(mdText))).toStrictEqual(expected);
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
    expect(mdCutOff(parseMarkdown(mdText), { maxLen: 5 })).toStrictEqual(expected);
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
    expect(mdCutOff(parseMarkdown(mdText), { maxHeight: 1 })).toStrictEqual(expected);
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

  it("image", () => {
    const mdText = "![tako](/data/tako.jpg)";
    expect(makeText(mdText)).toBe("tako");
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
    expect(makeHtml(mdText)).toBe("<h1>hello world</h1>");
  });

  it("header 2", () => {
    const mdText = "## hello world";
    expect(makeHtml(mdText)).toBe("<h2>hello world</h2>");
  });

  it("header 3", () => {
    const mdText = "### hello world";
    expect(makeHtml(mdText)).toBe("<h3>hello world</h3>");
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
    const mdText = "|hello world|";
    expect(makeHtml(mdText)).toBe("<table><tr><td>hello world</td></tr></table>");
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

  it("links", () => {
    const mdText = "[tako](tako.html) http://example.com/ika?uni=ebi#time";
    expect(makeHtml(mdText)).toBe(
      '<p>[tako](tako.html) <a href=\"http://example.com/ika?uni=ebi#time\">http://example.com/ika?uni=ebi#time</a></p>',
    );
  });

  it("escape", () => {
    const mdText = "\\::a:\\: \\*\\*b\\*\\* \\__c_\\_ \\~~d~\\~ \\``e`\\` \\\\123 \\A\\0";
    expect(makeHtml(mdText)).toBe("<p>::a:: **b** __c__ ~~d~~ ``e`` \\123 \\A\\0</p>");
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
    const expected = `<h1>H1</h1><p>abc<br>def</p><p>xyz</p><pre data-pre-mode="xml">&lt;a&gt;tako&lt;/a&gt;
ika</pre><h2>H2</h2><ul><li>a</li></ul><p>b</p><ul><li>c<ul><li>d<ul><li>e</li></ul></li><li>f</li></ul></li><li>g</li><li>h<ul><li>j<ul><li>k</li></ul></li></ul></li></ul><p>abc</p><table><tr><td><em>a</em></td><td>b</td></tr><tr><td>c</td><td><strong>d</strong></td></tr></table><figure class="image-block" data-thumbnail><img src="/data/def/ghi" alt="" decoding="async" loading="lazy"><figcaption>abc</figcaption></figure><h3>H3</h3>`;
    expect(makeHtml(mdText)).toBe(expected);
  });
});

describe("serialization", () => {
  it("empty body", () => {
    const mdText = "";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    const deserialized = deserializeMdNodes(serialized);
    expect(deserialized).toStrictEqual(nodes);
  });

  it("paragraph", () => {
    const mdText = "hello world";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe('[{"T":"p","X":"hello world"}]');
    const deserialized = deserializeMdNodes(serialized);
    expect(deserialized).toStrictEqual(nodes);
  });

  it("list", () => {
    const mdText = "- hello world\n- me too";
    const nodes = parseMarkdown(mdText);
    const serialized = serializeMdNodes(nodes);
    expect(serialized).toBe(
      '[{"T":"ul","C":[{"T":"li","X":"hello world"},{"T":"li","X":"me too"}]}]',
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(deserialized).toStrictEqual(nodes);
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
    expect(deserialized).toStrictEqual(nodes);
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
      "[{\"T\":\"p\",\"C\":[{\"X\":\"hello world\"},{\"T\":\"br\"},{\"X\":\"fetch \"},{\"T\":\"em\",\"X\":\"me\"},{\"X\":\" \"},{\"T\":\"strong\",\"X\":\"my\"},{\"X\":\" \"},{\"T\":\"u\",\"X\":\"hat\"},{\"X\":\".\"},{\"T\":\"br\"},{\"X\":\"line2\"}]},{\"T\":\"p\",\"X\":\"paragraph2\"},{\"T\":\"h1\",\"X\":\"first\"},{\"T\":\"h2\",\"X\":\"second\"},{\"T\":\"h3\",\"X\":\"third\"},{\"T\":\"ul\",\"C\":[{\"T\":\"li\",\"X\":\"hop step\"},{\"T\":\"li\",\"C\":[{\"T\":\"code\",\"X\":\"jump\"}]}]},{\"T\":\"table\",\"C\":[{\"T\":\"tr\",\"C\":[{\"T\":\"td\",\"X\":\"one\"},{\"T\":\"td\",\"X\":\"two\"}]}]},{\"T\":\"figure\",\"C\":[{\"T\":\"img\",\"SR\":\"/data/tako.png\",\"FE\":true},{\"T\":\"figcaption\",\"X\":\"img1\"}],\"CL\":\"image-block\"},{\"T\":\"p\",\"C\":[{\"X\":\"!\"},{\"T\":\"a\",\"X\":\"img2\",\"HF\":\"/xyz/tako.jpg\"},{\"X\":\"{grid}{no-featured}\"}]},{\"T\":\"div\",\"C\":[{\"T\":\"figure\",\"C\":[{\"T\":\"video\",\"SR\":\"/data/tako.mp4\",\"GD\":true},{\"T\":\"figcaption\",\"X\":\"video\"}],\"CL\":\"image-block\"}],\"CL\":\"image-grid\",\"DC\":1},{\"T\":\"hr\",\"HL\":2},{\"T\":\"blockquote\",\"C\":[{\"X\":\"foo bar\"},{\"T\":\"br\"},{\"T\":\"u\",\"X\":\"baz\"},{\"T\":\"br\"},{\"T\":\"ruby\",\"C\":[{\"T\":\"rb\",\"X\":\"abc\"},{\"T\":\"rt\",\"X\":\"def\"}]}]},{\"T\":\"p\",\"X\":\"EOF\"}]",
    );
    const deserialized = deserializeMdNodes(serialized);
    expect(deserialized).toStrictEqual(nodes);
  });
});
