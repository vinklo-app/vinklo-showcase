import { describe, expect, it } from "vitest";

import { isValidIbanEs, normalizeIban } from "./vendors";

describe("isValidIbanEs", () => {
  it("accepts a well-formed Spanish IBAN with spaces", () => {
    expect(isValidIbanEs("ES91 2100 0418 4502 0005 1332")).toBe(true);
  });

  it("accepts a well-formed Spanish IBAN without spaces", () => {
    expect(isValidIbanEs("ES9121000418450200051332")).toBe(true);
  });

  it("is case-insensitive on the country code", () => {
    expect(isValidIbanEs("es9121000418450200051332")).toBe(true);
  });

  it("rejects a non-Spanish IBAN", () => {
    expect(isValidIbanEs("FR1420041010050500013M02606")).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(isValidIbanEs("ES912100041845020005133")).toBe(false);
    expect(isValidIbanEs("ES912100041845020005133200")).toBe(false);
  });

  it("rejects non-digit characters after the country code", () => {
    expect(isValidIbanEs("ES91210004184502000513AB")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidIbanEs("")).toBe(false);
  });
});

describe("normalizeIban", () => {
  it("strips spaces and uppercases", () => {
    expect(normalizeIban("es91 2100 0418 4502 0005 1332")).toBe(
      "ES9121000418450200051332",
    );
  });
});
