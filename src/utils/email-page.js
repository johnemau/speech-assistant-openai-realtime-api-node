import { readFile } from 'node:fs/promises';
import { normalizeUSNumberToE164 } from './phone.js';
import { PRIMARY_CALLERS_SET } from '../env.js';
import {
    PAGE_EVALUATION_TEMPLATE,
    renderTemplate,
} from '../assistant/prompts.js';

/**
 * Read the page criteria file from disk.
 *
 * @param {string} [filePath] - Override path; defaults to env or `data/email-page-criteria.md`.
 * @returns {Promise<string>} File contents.
 */
export async function readPageCriteriaFile(filePath) {
    const resolved =
        filePath ||
        process.env.EMAIL_PAGE_CRITERIA_FILE_PATH ||
        'data/email-page-criteria.md';
    return readFile(resolved, 'utf-8');
}

/**
 * Build the prompt to evaluate whether an email is page-worthy and compose a summary.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.emailContent - Raw email content from the POST body.
 * @param {string} root0.criteria - Page criteria text from the criteria file.
 * @returns {string} Prompt for the model.
 */
export function buildPageEvaluationPrompt({ emailContent, criteria }) {
    return renderTemplate(PAGE_EVALUATION_TEMPLATE, { emailContent, criteria });
}

/**
 * Get all primary caller phone numbers as an array of E.164 strings.
 * Uses the live env var to support test overrides.
 *
 * @returns {string[]} Primary caller numbers.
 */
export function getPrimaryCallerNumbers() {
    const fromEnv = String(process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
        .map((v) => String(v));
    if (fromEnv.length) return fromEnv;
    return [...PRIMARY_CALLERS_SET];
}

/**
 * Parse a page evaluation JSON response from the model, stripping markdown code fences.
 *
 * @param {string} rawOutput - Raw model output text.
 * @returns {{ page_worthy: boolean, page_message?: string }} Parsed evaluation.
 */
export function parsePageEvaluation(rawOutput) {
    const cleaned = rawOutput
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
}
