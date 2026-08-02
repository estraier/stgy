import { Pool } from "pg";
import { AgreementTerm, AgreementTermContent } from "../models/agreementTerm";
import { decToHex, hexToDec, normalizeLocale, validateLocale } from "../utils/format";
import { pgQuery } from "../utils/servers";

const CONTENTS_LENGTH_LIMIT = 262144;

type AgreementTermRow = {
  id: string;
  contents: string;
};

export class AgreementTermsService {
  private readonly pgPool: Pool;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
  }

  async getLatestAgreementTerm(): Promise<AgreementTerm | null> {
    const res = await pgQuery<AgreementTermRow>(
      this.pgPool,
      `
        SELECT id, contents
        FROM user_agreement_terms
        ORDER BY id DESC
        LIMIT 1
      `,
      [],
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return rowToAgreementTerm(res.rows[0]);
  }

  async getAgreementTerm(id: string): Promise<AgreementTerm | null> {
    const res = await pgQuery<AgreementTermRow>(
      this.pgPool,
      `
        SELECT id, contents
        FROM user_agreement_terms
        WHERE id = $1
      `,
      [hexToDec(id)],
    );
    if ((res.rowCount ?? 0) === 0) return null;
    return rowToAgreementTerm(res.rows[0]);
  }

  async listAgreementTermIds(): Promise<string[]> {
    const res = await pgQuery<{ id: string }>(
      this.pgPool,
      `
        SELECT id
        FROM user_agreement_terms
        ORDER BY id DESC
      `,
      [],
    );
    return res.rows.map((row) => decToHex(row.id));
  }

  async putAgreementTerm(id: string, input: unknown): Promise<AgreementTerm> {
    const contents = validateAgreementTermContents(input);
    const serialized = JSON.stringify(contents);
    const res = await pgQuery<AgreementTermRow>(
      this.pgPool,
      `
        INSERT INTO user_agreement_terms (id, contents)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET
          contents = EXCLUDED.contents
        RETURNING id, contents
      `,
      [hexToDec(id), serialized],
    );
    return rowToAgreementTerm(res.rows[0]);
  }

  async deleteAgreementTerm(id: string): Promise<boolean> {
    const res = await pgQuery(
      this.pgPool,
      `
        DELETE FROM user_agreement_terms
        WHERE id = $1
      `,
      [hexToDec(id)],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async agreeToLatestAgreementTerm(userId: string, agreementTermId: string): Promise<boolean> {
    const res = await pgQuery(
      this.pgPool,
      `
        UPDATE user_secrets
        SET user_agreement_term_id = $2
        WHERE user_id = $1
          AND $2 = (
            SELECT id
            FROM user_agreement_terms
            ORDER BY id DESC
            LIMIT 1
          )
      `,
      [hexToDec(userId), hexToDec(agreementTermId)],
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export function validateAgreementTermContents(input: unknown): AgreementTermContent[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("contents must be a non-empty array");
  }

  const seenLocales = new Set<string>();
  const contents = input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`contents[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "locale" || keys[1] !== "text") {
      throw new Error(`contents[${index}] must contain only locale and text`);
    }
    if (typeof record.locale !== "string") {
      throw new Error(`contents[${index}].locale must be a string`);
    }
    if (typeof record.text !== "string") {
      throw new Error(`contents[${index}].text must be a string`);
    }

    const locale = normalizeLocale(record.locale);
    if (typeof locale !== "string" || !validateLocale(locale)) {
      throw new Error(`contents[${index}].locale is invalid`);
    }
    if (seenLocales.has(locale)) {
      throw new Error(`duplicate locale: ${locale}`);
    }
    if (record.text.trim().length === 0) {
      throw new Error(`contents[${index}].text must not be empty`);
    }
    seenLocales.add(locale);
    return { locale, text: record.text };
  });

  if (!seenLocales.has("en")) {
    throw new Error("contents must include the en locale");
  }
  if (Array.from(JSON.stringify(contents)).length > CONTENTS_LENGTH_LIMIT) {
    throw new Error(`contents exceeds ${CONTENTS_LENGTH_LIMIT} characters`);
  }

  return contents;
}

function rowToAgreementTerm(row: AgreementTermRow): AgreementTerm {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.contents);
  } catch {
    throw new Error("stored agreement terms contents is invalid JSON");
  }
  return {
    id: decToHex(row.id),
    contents: validateAgreementTermContents(parsed),
  };
}
