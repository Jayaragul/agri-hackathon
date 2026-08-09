# 🌾 Krishi Mitra

**AI-native decision support for smallholder farmers in Tamil Nadu, India.**

Krishi Mitra helps a beginner farmer decide *what to grow, how to fix their soil, what it will
cost, what could go wrong, and what to do next* — combining a deterministic agronomy engine with
Gemini-powered agents that explain, perceive, and converse, but never decide.

> Built for the **"Solving world hunger using AI"** track — a Google Developer Groups hackathon.

## The problem

Smallholder farmers make the highest-stakes decisions in agriculture — what crop to plant, how
much fertilizer to buy, when to sow — with the least reliable information, often relying on
guesswork, a neighbor's advice, or a fertilizer dealer with an incentive to oversell. A wrong
crop choice or a mistimed input purchase can mean a season of debt.

Krishi Mitra is designed specifically for a **first-time, possibly non-literate user** on a
budget Android phone: audio-first, plain language, and honest about what it doesn't know.

## The solution

A pre-sowing wizard scores every viable crop against the farmer's actual soil and land, a
cultivation calendar turns that into a day-by-day plan, and a set of AI agents explain, extract,
and converse around that plan — never replacing it. See
[Architecture & the AI boundary](#architecture--the-ai-boundary) for exactly how that split is
enforced in code, not just in a slide.
