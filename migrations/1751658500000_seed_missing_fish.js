// Supplemental seed: adds 3 fish/seafood recipes to reach 50 total.
const RECIPES = [
  { name: 'Pan-Roasted Halibut with Beurre Blanc', description: 'Wild halibut with classic French butter sauce, haricots verts, and fingerling potatoes', prep_time_minutes: 15, cook_time_minutes: 20, protein_type: 'fish', dietary_flags: ['gluten-free'], sourcing_standard: true, ingredients: [{name: 'halibut fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'butter', quantity: '4 tbsp'}, {name: 'shallot', quantity: '2'}, {name: 'white wine', quantity: '0.25 cup'}, {name: 'heavy cream', quantity: '2 tbsp'}, {name: 'haricots verts', quantity: '1 lb'}, {name: 'fingerling potato', quantity: '1 lb'}, {name: 'lemon', quantity: '1'}, {name: 'dijon mustard', quantity: '1 tsp'}, {name: 'chives', quantity: '2 tbsp'}], instructions: ['Boil potatoes and haricots verts until tender', 'Make beurre blanc: reduce wine and shallots, whisk in butter and cream off heat', 'Pat halibut dry, season', 'Sear in hot pan 3-4 min per side until opaque', 'Serve with potatoes, haricots verts, and beurre blanc'], tags: ['dinner', 'french', 'elegant'] },
  { name: 'Thai Coconut Shrimp Soup', description: 'Wild Gulf shrimp in aromatic coconut-lemongrass broth with mushrooms and Thai basil', prep_time_minutes: 15, cook_time_minutes: 20, protein_type: 'seafood', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'shrimp', quantity: '1.5 lbs', sourcing_hint: 'wild-caught gulf'}, {name: 'coconut milk', quantity: '1 can'}, {name: 'lemongrass', quantity: '2 stalks'}, {name: 'cremini mushrooms', quantity: '6 oz'}, {name: 'fish sauce', quantity: '2 tbsp'}, {name: 'lime', quantity: '2'}, {name: 'thai basil', quantity: '0.5 cup'}, {name: 'galangal', quantity: '1 inch'}, {name: 'garlic', quantity: '3 cloves'}, {name: 'shallot', quantity: '1'}], instructions: ['Simmer coconut milk with lemongrass, galangal, and shallot 10 min', 'Add mushrooms, cook 3 min', 'Add shrimp, cook 4-5 min until pink', 'Season with fish sauce and lime', 'Top with Thai basil, serve immediately'], tags: ['dinner', 'thai', 'soup'] },
  { name: 'Cedar Plank Salmon with Maple Mustard', description: 'Wild salmon on cedar plank with brown sugar-mustard glaze, roasted root vegetables', prep_time_minutes: 15, cook_time_minutes: 25, protein_type: 'fish', dietary_flags: ['gluten-free', 'dairy-free'], sourcing_standard: true, ingredients: [{name: 'salmon fillet', quantity: '1.5 lbs', sourcing_hint: 'wild-caught'}, {name: 'dijon mustard', quantity: '3 tbsp'}, {name: 'maple syrup', quantity: '2 tbsp'}, {name: 'apple cider vinegar', quantity: '1 tbsp'}, {name: 'garlic', quantity: '2 cloves'}, {name: 'parsnip', quantity: '2'}, {name: 'carrot', quantity: '3'}, {name: 'olive oil', quantity: '2 tbsp'}, {name: 'fresh thyme', quantity: '4 sprigs'}, {name: 'lemon', quantity: '1'}], instructions: ['Soak cedar plank in water 30 min', 'Mix mustard, maple syrup, vinegar, garlic for glaze', 'Toss root veg with oil and thyme, roast at 425F 20 min', 'Season salmon, brush with glaze', 'Place salmon on plank, roast 12-15 min until done', 'Serve with roasted vegetables'], tags: ['dinner', 'grilling', 'autumn'] }
];

module.exports = {
  name: 'seed_missing_fish',
  up: async (client) => {
    const insert = `INSERT INTO recipes (name, description, prep_time_minutes, cook_time_minutes, protein_type, dietary_flags, sourcing_standard, ingredients, instructions, tags)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
                    ON CONFLICT DO NOTHING`;
    for (const r of RECIPES) {
      await client.query(insert, [
        r.name,
        r.description,
        r.prep_time_minutes,
        r.cook_time_minutes,
        r.protein_type,
        r.dietary_flags,
        r.sourcing_standard,
        JSON.stringify(r.ingredients),
        JSON.stringify(r.instructions),
        r.tags
      ]);
    }
    console.log(`Seeded ${RECIPES.length} additional recipes`);
  }
};