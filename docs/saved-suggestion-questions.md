# Saved suggestion questions

Saved from the reverted suggestion-card experiment (`f3719a6`). These prompts are ideas for later use; they are not enabled in the application. The previous suggestion UI is restored from `d793eba`.

## Questions

### Chart at a glance

Roles: Physician, nurse.

Summarize the documented conditions, medications and allergies. Cite the chart records and flag missing information.

### Contact preferences

Roles: ['clerical'].

What contact preferences and interpreter needs are documented for this patient? Cite the records and say what is missing.

### Medication review

Roles: Physician, nurse.

List the current medications with their documented dose, route and frequency. Flag missing instructions and cite the source records.

### Prescription status

Roles: ['nurse'].

Which current prescriptions have a dispensing record, and which have no documented fill? Cite the prescription and dispensing records.

### Problem list

Roles: Physician, nurse.

Which conditions are marked active in the chart? Include their recorded onset dates when available and cite the source records.

### Latest lab results

Roles: Physician, nurse.

List the latest available lab results with dates, units and reference ranges where documented. Cite each result.

### Compare recent labs

Roles: Physician, nurse.

Compare the two most recent results for each repeated lab test. Show dates and changes without inferring a diagnosis. Cite the results.

### Vital signs

Roles: Physician, nurse.

Show the latest documented vital signs and compare each with its previous measurement. Include dates, units and source records.

### Allergy record

Roles: Physician, nurse.

What allergies and reactions are documented? Distinguish explicit no-known-allergy records from missing information and cite the records.

### Last visit

Roles: Physician, nurse.

Summarize the most recent completed encounter: date, reason and linked observations or notes. Cite the records and identify missing details.

### Visit history

Roles: ['clerical'].

List the three most recent completed visits with dates, visit types and locations where documented. Cite the encounter records.

### Recent notes

Roles: Physician, nurse.

Find the most recent clinical note and summarize its documented follow-up instructions. Cite the note; say if no instructions are available.

### Documents on file

Roles: ['clerical'].

List the most recent documents on file, with their types, dates and statuses. Cite the source records.

### Appointment check

Roles: ['clerical', 'nurse'].

Which appointments are upcoming as of the chart date? Include their status, time and location where documented, and cite the records.

### Open orders

Roles: ['clerical', 'nurse', 'physician'].

Which orders are still open in the chart? Include the order date and any linked completion record. Cite the sources.

## Undoing a published change safely

Use `git revert <commit>` and push the resulting commit to undo a published change without rewriting history. To bring back a reverted change, revert the revert commit. Use `git log --oneline` to find its id.
