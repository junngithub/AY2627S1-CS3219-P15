import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function formatTime(raw: string): string {
  const digits = raw.replace("hrs", "");
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

const rawData = [
  { name: "Anna's x Soup Union", categories: ["Food"], building: "Central Library", floor: "1", locationDescription: "Next to NUS Co-op", latitude: 1.296444, longitude: 103.773032, startingTime: "0900hrs", closingTime: "1800hrs" },
  { name: "NUS Co-op", categories: ["Shopping"], building: "Central Library", floor: "1", locationDescription: "Inside the library on the right side", latitude: 1.2967866, longitude: 103.7732677, startingTime: "0900hrs", closingTime: "1600hrs" },
  { name: "Printer @ Com 2", categories: ["Printing"], building: "Com 2", floor: "1", locationDescription: "Next to LT19", latitude: 1.2938347, longitude: 103.7744572, startingTime: "0000hrs", closingTime: "2359hrs" },
  { name: "Cool Spot", categories: ["Food"], building: "Com2", floor: "1", locationDescription: "Opp LT16", latitude: 1.2940156, longitude: 103.7738478, startingTime: "0900hrs", closingTime: "2130hrs" },
  { name: "InstaChef", categories: ["Food"], building: "Terrace", floor: "1", locationDescription: "Next to foyer", latitude: 1.2938898, longitude: 103.7736305, startingTime: "0000hrs", closingTime: "2359hrs" },
  { name: "Cafe+ Robot Cafe", categories: ["Food", "Coffee"], building: "Central Library", floor: "1", locationDescription: "Opp to central library entrance", latitude: 1.296444, longitude: 103.773032, startingTime: "0000hrs", closingTime: "2359hrs" },
  { name: "A Hot Hideout", categories: ["Food"], building: "Prince George's Park", floor: "2", locationDescription: "Near PGP entrance", latitude: 1.2908445, longitude: 103.7770891, startingTime: "1100hrs", closingTime: "2130hrs" },
  { name: "Arise and Shine", categories: ["Food"], building: "Engineering Block E4", floor: "4", locationDescription: "Near LT6", latitude: 1.2991517, longitude: 103.769064, startingTime: "0800hrs", closingTime: "1800hrs" },
  { name: "Bakehaus / Aurea", categories: ["Food"], building: "The Ridge", floor: "1", locationDescription: "Near COM2", latitude: 1.2946778, longitude: 103.7707872, startingTime: "0800hrs", closingTime: "2100hrs" },
  { name: "Central Square @ YIH", categories: ["Food"], building: "Yusof Ishak House", floor: "1", locationDescription: "Closest to Opp UHC bus stop", latitude: 1.2984401, longitude: 103.7726256, startingTime: "0800hrs", closingTime: "2000hrs" },
  { name: "Pasta Express", categories: ["Food"], building: "Frontier", floor: "1", locationDescription: "Aircon section", latitude: 1.2947819, longitude: 103.7704435, startingTime: "0930hrs", closingTime: "1930hrs" },
  { name: "TOMORO COFFEE", categories: ["Food", "Coffee"], building: "Hon Sui Sen Memorial Library", floor: "2", locationDescription: "Inside HSSML", latitude: 1.2931259, longitude: 103.7719943, startingTime: "0815hrs", closingTime: "1800hrs" },
  { name: "Octobox", categories: ["Shopping"], building: "Prince George's Park", floor: "2", locationDescription: "Near PGP entrance", latitude: 1.2904347, longitude: 103.7787588, startingTime: "0000hrs", closingTime: "2359hrs" },
  { name: "Smooy", categories: ["Food"], building: "COM3", floor: "1", locationDescription: "The Terrace @ COM3", latitude: 1.2948308, longitude: 103.7716305, startingTime: "1100hrs", closingTime: "2100hrs" },
  { name: "Goh Bros E-Print Pte Ltd", categories: ["Printing"], building: "Yusof Ishak House", floor: "5", locationDescription: "Take the long staircase up YIH", latitude: 1.2984905, longitude: 103.7720544, startingTime: "0900hrs", closingTime: "1800hrs" },
  { name: "Cheers Unmanned Convenience Store", categories: ["Shopping"], building: "Engineering Block E3", floor: "4", locationDescription: "Take right from Arise n Shine", latitude: 1.2994341, longitude: 103.7526298, startingTime: "0000hrs", closingTime: "2359hrs" },
  { name: "Nami", categories: ["Food"], building: "innovation4.0", floor: "1", locationDescription: "Opp TCOMS", latitude: 1.2942982, longitude: 103.7708813, startingTime: "0800hrs", closingTime: "1730hrs" },
  { name: "Good Day Cafe", categories: ["Food", "Coffee"], building: "Medicine+Science Library", floor: "1", locationDescription: "Inside MedScience library", latitude: 1.2967989, longitude: 103.7794336, startingTime: "0730hrs", closingTime: "1830hrs" },
  { name: "The Coffee Roaster", categories: ["Food", "Coffee"], building: "Blk AS8", floor: "1", locationDescription: "Behind central library bus stop", latitude: 1.296252229, longitude: 103.7720926, startingTime: "0800hrs", closingTime: "1730hrs" },
  { name: "he by He Brews", categories: ["Food", "Coffee"], building: "Engineering Block EA", floor: "1", locationDescription: "Near LT7 & Engineering Auditorium", latitude: 1.300566804, longitude: 103.7707577, startingTime: "0800hrs", closingTime: "1700hrs" },
  { name: "Supersnacks", categories: ["Food"], building: "Prince George's Park", floor: "1", locationDescription: "At level 1 in Prince George's Park Residences, Block 10", latitude: 1.2913847, longitude: 103.7776367, startingTime: "1100hrs", closingTime: "0200hrs" },
];


async function main() {
  await prisma.supplier.deleteMany({});
  await prisma.category.deleteMany({});

  for (const s of rawData) {
    await prisma.supplier.create({
      data: {
        name: s.name,
        building: s.building,
        floor: s.floor,
        locationDescription: s.locationDescription,
        latitude: s.latitude,
        longitude: s.longitude,
        startingTime: formatTime(s.startingTime),
        closingTime: formatTime(s.closingTime),
        status: "approved",
        categories: {
          connectOrCreate: s.categories.map((catName) => ({
            where: { name: catName },
            create: { name: catName },
          })),
        },
      },
    });
  }

  console.log(`Seeded ${rawData.length} suppliers with categories.`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());