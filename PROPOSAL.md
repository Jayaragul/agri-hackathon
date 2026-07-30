# CODE SASTRA

**Tech for Good 2026** · GDG Coimbatore · Build weekend Aug 8–9, GRD College

**Track:** AI for Zero Hunger & Economic Growth
**Team code:** TEAM-012

## Problem

Jayasurya, a small farmer from Coimbatore, struggles to understand soil reports and choose the right crop and inputs. This can lead to unsuitable crop choices, unnecessary chemical use, higher costs, and lower yield.

## Who it helps

Our primary user is Jayasurya, a farmer from Coimbatore. The prototype helps him answer:

“Which crop is best suited to my soil, and which natural input can improve soil health and yield?”

The solution can later support other new and first-time farmers who face similar difficulties in understanding soil reports and choosing suitable crops and natural inputs.

## Solution

We are building an AI-powered agricultural assistant with native-language support for Jayasurya and other new farmers.

The prototype analyzes a farmer’s soil report, location, and current weather conditions to recommend suitable crops. It identifies important soil deficiencies and suggests natural or biological inputs, such as compost, green manure, and biofertilizers, before recommending chemical fertilizers.

The recommendations are explained in simple Tamil so farmers can make faster and better-informed decisions.

For the hackathon, we will focus on three outputs:

1. Suitable crop recommendations
2. Soil nutrient deficiency identification
3. Natural input suggestions to improve soil health and support yield

Future versions may include IoT data, yield prediction, pest detection, profitability estimation, personalized cultivation plans, and a farm digital twin.

The solution supports UN SDG 2: Zero Hunger by promoting informed, sustainable, and cost-effective farming decisions.

## Architecture

Farmer Inputs
(Soil report, location, season, and farm details)
↓
AI Harness Workflow
(Coordinates OCR, data retrieval, and recommendations)
↓
Gemini Vision OCR
(Extracts pH, nitrogen, phosphorus, potassium, and other soil values)
↓
Farmer Verification
(Confirms or corrects the extracted values)
↓
Weather API
(Provides current and seasonal weather information)
↓
Agricultural Knowledge Base
(RAG using government guidelines, crop data, research papers, and best practices)
↓
Gemini LLM and Recommendation Engine
↓
• Suitable crop recommendations
• Nutrient deficiency identification
• Natural and biological input suggestions
• Estimated cultivation cost and ROI range
↓
FastAPI Backend
↓
PostgreSQL / Firebase
↓
Tamil Farmer Dashboard


## Tech stack

React.js, FastAPI, Google AI Harness, Gemini Vision, Gemini LLM,Firebase, Google Cloud Storage, Google Cloud Run, Google Cloud Platform, Weather API, PostgreSQL

## Getting started

1. Accept your collaborator invite (check your email / GitHub notifications).
2. Clone this repo and start building.
3. Commit early and often — this repo is what you present on the day.

---

_Created automatically when your proposal was validated._