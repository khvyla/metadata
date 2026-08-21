import { describe, expect, it } from "vitest";
import { processMetadata } from "../src";
import { assessAirplayEligibility } from "../src/quality";

const assess = (artist?: string, title?: string) => assessAirplayEligibility({ track: { artist, title } });

describe("airplay observation quality", () => {
  it("accepts normal artist/title", () => {
    expect(assess("Stan Getz", "Misty")).toEqual({ eligible: true, reasons: [] });
  });

  it("rejects a missing artist", () => {
    expect(assess("", "Fm Галичина").reasons).toEqual(["missing-artist"]);
  });

  it("rejects a missing title", () => {
    expect(assess("Artist", " ").reasons).toEqual(["missing-title"]);
  });

  it("rejects unknown values", () => {
    expect(assess("Artist", "Unknown").reasons).toEqual(["unknown-value"]);
  });

  it("rejects obvious encoding corruption", () => {
    expect(assess("Artist", "��� �����").reasons).toEqual(["encoding-corruption"]);
  });

  it("rejects obvious station identifiers", () => {
    expect(assess("Kyiv 98FM", "OnAir").reasons).toEqual(["station-identifier"]);
  });

  it("rejects service and donation messages", () => {
    expect(assess("Support Radio", "PayPal donate@example.com").reasons).toEqual(["service-message"]);
  });

  it("rejects email addresses", () => {
    expect(assess("Station", "contact@example.com").reasons).toEqual(["service-message"]);
  });

  it("rejects URL-like service metadata", () => {
    expect(assess("Station", "https://example.com/donate").reasons).toEqual(["service-message"]);
  });

  it("accepts normal Unicode metadata", () => {
    expect(assess("Наталка Карпа", "Літо (Kaminsky Mash Up)")).toEqual({ eligible: true, reasons: [] });
  });

  it("accepts multiple artists", () => {
    expect(assess("Thundercat, Lil Yachty, Flying Lotus", "I Did This To Myself")).toEqual({ eligible: true, reasons: [] });
  });

  it("accepts normal punctuation and special characters", () => {
    expect(assess("S’Express", "Theme from S-Express!")).toEqual({ eligible: true, reasons: [] });
  });

  it("does not alter parser or resolver-compatible canonical metadata", () => {
    const metadata = processMetadata("StreamTitle=' - Fm Галичина';");
    expect(metadata.track?.title).toBe("- Fm Галичина");
    expect(assessAirplayEligibility(metadata)).toEqual({ eligible: false, reasons: ["missing-artist"] });
  });
});
