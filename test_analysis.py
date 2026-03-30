import os
import sys

# Ensure we can import brain.py
sys.path.append("/Users/basavaprabhu/dpdp")
from brain import analyze_policy

sample_policy = """
XYZ ORGANIZATION DATA PROTECTION POLICY
EFFECTIVE DATE:
[Insert Date]
REVIEW DATE:
[Insert Date]
VERSION:
1.0
---
1. PURPOSE
The purpose of this Data Protection Policy is to ensure that XYZ Organization complies with the Digital Personal Data Protection Act 2023 (DPDP) and other applicable data protection laws. This policy outlines the principles and procedures for the collection, processing, storage, and sharing of personal data.
2. SCOPE
This policy applies to all employees, contractors, and third-party service providers of XYZ Organization who handle personal data in the course of their work.
3. DEFINITIONS
PERSONAL DATA:
Any information relating to an identified or identifiable individual.

DATA SUBJECT:
An individual whose personal data is processed by XYZ Organization.

CONTROLLER:
The entity that determines the purposes and means of processing personal data.

PROCESSOR:
The entity that processes personal data on behalf of the controller.
4. DATA PROTECTION PRINCIPLES
XYZ Organization is committed to ensuring that personal data is:
Processed lawfully, fairly, and transparently.

Collected for specified, legitimate purposes and not further processed in a manner incompatible with those purposes.

Adequate, relevant, and limited to what is necessary for the purposes for which it is processed.

Accurate and kept up to date.

Kept in a form which permits identification of data subjects for no longer than necessary.

Processed in a manner that ensures appropriate security of the personal data.
5. DATA PROTECTION OFFICER (DPO)
XYZ Organization has appointed a Data Protection Officer (DPO) who is responsible for overseeing data protection compliance. The DPO can be contacted at [DPO Contact Information].
6. RIGHTS OF DATA SUBJECTS
Data subjects have the following rights under the DPDP:
The right to access their personal data.

The right to rectify inaccurate personal data.

The right to erase personal data (right to be forgotten).

The right to restrict processing.

The right to data portability.

The right to object to processing.
7. DATA BREACH NOTIFICATION
In the event of a data breach, XYZ Organization will notify the relevant supervisory authority and affected data subjects as required by the DPDP. A data breach response plan is in place to manage such incidents.
8. TRAINING AND AWARENESS
All employees will receive training on data protection principles and practices. Regular awareness programs will be conducted to ensure compliance with this policy.
9. DATA RETENTION
Personal data will be retained only for as long as necessary to fulfill the purposes for which it was collected, in accordance with applicable laws and regulations.
10. REVIEW AND AMENDMENTS
This policy will be reviewed annually and may be amended as necessary to ensure compliance with the DPDP and other applicable laws.
11. COMPLIANCE AND ENFORCEMENT
Failure to comply with this policy may result in disciplinary action, up to and including termination of employment or contract.
---
APPROVAL:
This Data Protection Policy has been approved by the management of XYZ Organization.
SIGNATURE:

[Name]
[Title]
[Date]
---
NOTE:
This policy document is a template and should be customized to fit the specific needs and context of XYZ Organization. Legal counsel should review the policy to ensure compliance with all applicable laws and regulations.
"""

large_policy = sample_policy * 1

print(f"Testing analyze_policy with a policy of {len(large_policy)} characters...")
response, sources = analyze_policy(large_policy)
print("\n--- FINAL JSON OUTPUT ---")
print(response)
print("\n--- SOURCES ---")
print(sources)
