// RB-1: a path can't leave the repo; a folder's entries are folders first, A to Z; a file is text only when it is.
import { describe, expect, it } from "vitest";
import { cleanPath, fileKind, sortEntries, TEXT_MAX_BYTES, branchName, sizeWords } from "./code.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("cleanPath", () => {
  it("keeps a path inside the repo", () => {
    expect(cleanPath("/")).toBe("/");
    expect(cleanPath("/a/b.sql")).toBe("/a/b.sql");
    expect(cleanPath("/a/b/")).toBe("/a/b");
    expect(cleanPath("/Sales model.pbix")).toBe("/Sales model.pbix");
  });
  it.each(["", "a/b", "/../x", "/a/../../b", "/a/./b", "//a", "/a//b", "/a\\b", "/a\u0000b", "/a\nb", 42, null, `/${"x".repeat(1100)}`])("refuses %j", (p) => expect(cleanPath(p)).toBeNull());
});

describe("entries and files", () => {
  it("folders first, then files, A to Z", () => {
    const e = [{ name: "b.sql", path: "/b.sql", folder: false }, { name: "Z", path: "/Z", folder: true }, { name: "A.sql", path: "/A.sql", folder: false }, { name: "a", path: "/a", folder: true }];
    expect(sortEntries(e).map((x) => x.name)).toEqual(["a", "Z", "A.sql", "b.sql"]);
  });
  it("text, binary, image, too large and an LFS pointer", () => {
    expect(fileKind({ name: "a.sql", size: 8, bytes: enc("SELECT 1") })).toBe("text");
    expect(fileKind({ name: "a.bin", size: 4, bytes: new Uint8Array([1, 0, 2, 3]) })).toBe("binary");
    expect(fileKind({ name: "a.txt", size: 2, bytes: new Uint8Array([0xc3, 0x28]) })).toBe("binary");
    expect(fileKind({ name: "a.png", size: 4, bytes: enc("PNG!") })).toBe("image");
    expect(fileKind({ name: "a.dat", size: 4, bytes: enc("abcd"), isImage: true })).toBe("image");
    expect(fileKind({ name: "a.svg", size: 6, bytes: enc("<svg/>"), isImage: true })).toBe("text");
    expect(fileKind({ name: "a.csv", size: TEXT_MAX_BYTES + 1, bytes: null })).toBe("too_large");
    expect(fileKind({ name: "a.csv", size: null, bytes: new Uint8Array(TEXT_MAX_BYTES + 1).fill(65) })).toBe("too_large");
    expect(fileKind({ name: "a.parquet", size: 120, bytes: enc("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10\n") })).toBe("lfs");
  });
  it("names a branch and a size in plain words", () => {
    expect(branchName("refs/heads/release/2")).toBe("release/2");
    expect(branchName(undefined)).toBeNull();
    expect(sizeWords(3_400_000)).toBe("3.2 MB");
    expect(sizeWords(1)).toBe("1 byte");
  });
});
