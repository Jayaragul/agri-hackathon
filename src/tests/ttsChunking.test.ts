import { describe, it, expect } from "vitest";
import { chunkTextForTts } from "../services/voice/ttsChunking";

describe("chunkTextForTts", () => {
  it("returns an empty array for empty/whitespace-only input", () => {
    expect(chunkTextForTts("")).toEqual([]);
    expect(chunkTextForTts("   ")).toEqual([]);
  });

  it("returns the text unchanged in one chunk when already under the limit", () => {
    const text = "Soil pH matters a lot.";
    expect(chunkTextForTts(text)).toEqual([text]);
  });

  it("never produces a chunk longer than the limit", () => {
    const text = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i}, and it says something about farming.`).join(" ");
    const chunks = chunkTextForTts(text, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it("splits at sentence boundaries rather than mid-word when possible", () => {
    const text = "First sentence here. Second sentence here. Third sentence here.".repeat(10);
    const chunks = chunkTextForTts(text, 60);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
    // Every chunk boundary should land right after sentence-ending punctuation, not mid-word.
    for (const chunk of chunks) {
      expect(/[.!?]$/.test(chunk.trim())).toBe(true);
    }
  });

  it("hard-slices a single run-on sentence with no punctuation at all", () => {
    const text = "a".repeat(1200);
    const chunks = chunkTextForTts(text, 500);
    expect(chunks).toEqual([text.slice(0, 500), text.slice(500, 1000), text.slice(1000, 1200)]);
  });

  it("reassembles to the original text when chunks are joined with spaces", () => {
    const text = "Apply lime if the soil is too acidic. Add gypsum if it is too alkaline. Test again after a season.";
    const chunks = chunkTextForTts(text, 40);
    expect(chunks.join(" ")).toBe(text);
  });

  it("fits a real ~700-character knowledge-base answer in a single chunk under bulbul:v3's higher limit", () => {
    const longAnswer =
      "Soil pH is the single most important soil factor because it controls nutrient availability. " +
      "Below 5.0, aluminum and manganese become toxic and most crops fail. Between 5.5 and 7.0 is the optimal zone " +
      "for most crops, with maximum nutrient availability. Above 8.0, iron, zinc, manganese and phosphorus all " +
      "become locked up. To fix an acidic soil, add lime at two to four tonnes per acre. To fix an alkaline soil, " +
      "add gypsum along with a green manure crop such as Dhaincha. In Coimbatore, red calcareous soils often sit " +
      "at pH 7.5 to 8.0, so watch closely for micronutrient deficiencies through the season.";
    expect(longAnswer.length).toBeGreaterThan(500);
    expect(longAnswer.length).toBeLessThan(2000);
    // Default MAX_CHARS is now bulbul:v3's real headroom, not the older 500-char batch-request
    // limit — a farmer no longer waits through multiple round-trips for an answer this length.
    expect(chunkTextForTts(longAnswer)).toEqual([longAnswer]);
  });

  it("still chunks an answer that genuinely exceeds the default limit, without dropping content", () => {
    const paragraph =
      "Soil pH is the single most important soil factor because it controls nutrient availability. " +
      "Below 5.0, aluminum and manganese become toxic and most crops fail. Between 5.5 and 7.0 is the optimal zone " +
      "for most crops, with maximum nutrient availability. Above 8.0, iron, zinc, manganese and phosphorus all " +
      "become locked up. To fix an acidic soil, add lime at two to four tonnes per acre. To fix an alkaline soil, " +
      "add gypsum along with a green manure crop such as Dhaincha. In Coimbatore, red calcareous soils often sit " +
      "at pH 7.5 to 8.0, so watch closely for micronutrient deficiencies through the season. ";
    const longAnswer = paragraph.repeat(4).trim();
    expect(longAnswer.length).toBeGreaterThan(2000);
    const chunks = chunkTextForTts(longAnswer);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join(" ")).toBe(longAnswer);
  });
});
