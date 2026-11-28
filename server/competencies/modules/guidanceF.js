module.exports = {
    guidanceKey: 'guidance-f',
    guidanceLabel: 'Guidance F — Information delivery planning',
    unlockScore: 2500,
    unlockedByDefault: true, // Testing & Mo demo override; set to false to enforce quiz unlock
    challenges: [
        {
            id: 'guidance-f-tidp-v1',
            title: 'Build a Compliant Mini-TIDP in Morta',
            difficulty: 'Foundation',
            estimatedMinutes: 8,
            deliverableType: 'table',
            scenario: 'You are the Architectural Task Team Information Manager preparing a Task Information Delivery Plan (TIDP) in Morta for RIBA Stage 2 under ISO 19650-2 and IMI Guidance F.',
            instructions: [
                'Create a new Table in your Morta hub (or open your shared Sandbox Hub test table).',
                'Include at minimum these 4 columns: Container ID, Title, Suitability Code, and Revision.',
                'Populate 5 realistic architectural deliverables (a mix of 3D models and 2D drawings) following UK ISO 19650 naming, suitability, and revision rules.',
                'Copy the Morta Table URL from your browser and paste it below for live AI auditing.'
            ],
            requiredColumns: ['Container ID', 'Title', 'Suitability Code', 'Revision'],
            auditFocus: [
                'Check that 3D models use M3 and 2D drawings/plans use DR (flag mismatches like M3 on a Floor Plan).',
                'Check that level/location codes match the deliverable title (e.g., 00 or GF for Ground Floor, 01 for Level 1).',
                'Verify valid ISO 19650 suitability codes (S0, S1, S2, S3, S4) and preliminary revisions (P01, P02, etc.).',
                'Check whether at least 5 distinct, non-duplicate deliverable rows are populated.'
            ],
            rubric: [
                {
                    id: 'c1',
                    name: 'ISO 19650 Container Naming',
                    description: 'Container IDs follow consistent fields and match deliverable type (e.g., M3 for 3D models, DR for 2D drawings) and spatial level.',
                    maxScore: 25
                },
                {
                    id: 'c2',
                    name: 'Suitability Code Accuracy',
                    description: 'Valid ISO 19650 suitability codes (S0–S4) appropriate for WIP/Shared coordination.',
                    maxScore: 25
                },
                {
                    id: 'c3',
                    name: 'Revision Control',
                    description: 'Proper preliminary/contractual revision conventions (e.g., P01, P02, C01).',
                    maxScore: 25
                },
                {
                    id: 'c4',
                    name: 'Completeness & TIDP Coverage',
                    description: 'All required columns present and 5 clear, non-duplicate architectural rows populated.',
                    maxScore: 25
                }
            ]
        }
        // Future challenges for Guidance F (e.g., 'guidance-f-midp-v1') simply append here
    ]
};