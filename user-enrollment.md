# My Starter Profile — User Enrollment Process

This document describes how new users are registered onto the pre-approved list and how they complete SMS consent enrollment for the My Starter Profile messaging program.

## Step 1: Admin Adds User to Pre-Approved List

A service administrator manually adds the user's phone number (in E.164 format, e.g. +12065550100) to the pre-approved allowlist. Only phone numbers on this list are permitted to send or receive SMS messages through the program.

Users not on the pre-approved list receive the following message and no further interaction is possible:

> "My Starter Profile: This SMS line is restricted to approved users."

## Step 2: User Initiates SMS Enrollment

Once on the pre-approved list, the user texts **START** to the My Starter Profile 10DLC phone number. The system records a "pending" consent status and replies:

> "My Starter Profile: To confirm enrollment, reply YES. Msg frequency varies. Msg&Data Rates May Apply. Reply HELP for help, STOP to cancel. Privacy Policy: https://phantom-speech-assistant-openai-realtime.onrender.com/privacy-policy"

No AI-generated messages are sent at this stage.

## Step 3: User Confirms with YES

The user replies **YES** to complete enrollment. The system records a "confirmed" consent status and replies:

> "Welcome to My Starter Profile! You're now enrolled. Msg frequency varies. Msg&Data Rates May Apply. Reply HELP for help, STOP to opt out. Privacy Policy: https://phantom-speech-assistant-openai-realtime.onrender.com/privacy-policy"

The user is now fully enrolled and will receive AI-generated SMS replies in response to their text messages.

## Program Details

- **Brand:** My Starter Profile
- **Message frequency:** Varies based on user-initiated interactions
- **Message content:** AI-generated replies to user questions (e.g. local business info, directions, weather, current events, general knowledge)
- **Marketing content:** None — no promotional or marketing messages are sent
- **Message and data rates may apply**
- **Carriers are not liable for any delayed or undelivered messages**

## Opt-Out and Help

- Reply **STOP** at any time to unsubscribe. A confirmation is sent and no further messages will be delivered. The user may text START again to re-enroll.
- Reply **HELP** for assistance and program information.

## Consent Record Keeping

All consent events (START, YES, STOP) are persisted with the user's phone number, keyword, derived status, and timestamp to an audit log for compliance.

## Links

- [Privacy Policy](https://phantom-speech-assistant-openai-realtime.onrender.com/privacy-policy)
- [Terms of Service](https://phantom-speech-assistant-openai-realtime.onrender.com/tos)
- [How to Opt In](https://phantom-speech-assistant-openai-realtime.onrender.com/how-to-opt-in)
