import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLinePrompt, InputEndedError } from "./line-prompt";

function setup() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (d: Buffer) => {
    shown += d.toString();
  });
  const prompt = createLinePrompt(input, output);
  return { input, prompt, shown: () => shown };
}

describe("createLinePrompt", () => {
  it("answers questions in order, even from lines piped in before they are asked", async () => {
    const { input, prompt, shown } = setup();
    input.write("one\ntwo\n");
    expect(await prompt.ask("First?")).toBe("one");
    expect(await prompt.ask("Second?", "dflt")).toBe("two");
    expect(shown()).toContain("? First? ");
    expect(shown()).toContain("? Second? (dflt) ");
    prompt.close();
  });

  it("waits for a line typed later", async () => {
    const { input, prompt } = setup();
    const answer = prompt.ask("Name?");
    input.write("Ada\n");
    expect(await answer).toBe("Ada");
    prompt.close();
  });

  it("fails a question once the input has ended", async () => {
    const { input, prompt } = setup();
    input.end("last\n");
    expect(await prompt.ask("A?")).toBe("last");
    await expect(prompt.ask("B?")).rejects.toBeInstanceOf(InputEndedError);
  });
});
