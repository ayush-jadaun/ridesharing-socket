// Mock driver data for testing (all INSIDE DELHI only)
const mockDrivers = [
  {
    driverId: "driver_001",
    driverName: "Rajesh Kumar",
    vehicleType: "car",
    vehicleNumber: "DL01AB1234",
    rating: 4.5,
    location: { latitude: 28.6139, longitude: 77.209 }, // Connaught Place, Central Delhi
    status: "available",
  },
  {
    driverId: "driver_002",
    driverName: "Priya Sharma",
    vehicleType: "bike",
    vehicleNumber: "DL02CD5678",
    rating: 4.8,
    location: { latitude: 28.6328, longitude: 77.2205 }, // Karol Bagh, Delhi
    status: "available",
  },
  {
    driverId: "driver_003",
    driverName: "Amit Singh",
    vehicleType: "auto",
    vehicleNumber: "DL03EF9012",
    rating: 4.2,
    location: { latitude: 28.6619, longitude: 77.2274 }, // Civil Lines, North Delhi
    status: "available",
  },
  {
    driverId: "driver_004",
    driverName: "Sunita Devi",
    vehicleType: "car",
    vehicleNumber: "DL04GH3456",
    rating: 4.7,
    location: { latitude: 28.5672, longitude: 77.21 }, // Hauz Khas, South Delhi
    status: "available",
  },
  {
    driverId: "driver_005",
    driverName: "Mohammad Ali",
    vehicleType: "bike",
    vehicleNumber: "DL05IJ7890",
    rating: 4.1,
    location: { latitude: 28.5245, longitude: 77.1855 }, // South Extension, South Delhi
    status: "available",
  },
  {
    driverId: "driver_006",
    driverName: "Kavita Patel",
    vehicleType: "car",
    vehicleNumber: "DL06KL2345",
    rating: 4.9,
    location: { latitude: 28.7041, longitude: 77.1025 }, // Rohini, North West Delhi
    status: "available",
  },
  {
    driverId: "driver_007",
    driverName: "Ravi Gupta",
    vehicleType: "auto",
    vehicleNumber: "DL07MN6789",
    rating: 4.3,
    location: { latitude: 28.5733, longitude: 77.2425 }, // Lajpat Nagar, South Delhi
    status: "available",
  },
  {
    driverId: "driver_008",
    driverName: "Deepika Yadav",
    vehicleType: "bike",
    vehicleNumber: "DL08OP1234",
    rating: 4.6,
    location: { latitude: 28.687, longitude: 77.2946 }, // Shahdara, East Delhi
    status: "available",
  },
  {
    driverId: "driver_009",
    driverName: "Sandeep Chauhan",
    vehicleType: "car",
    vehicleNumber: "DL09QR5678",
    rating: 4.4,
    location: { latitude: 28.6791, longitude: 77.1025 }, // Pitampura, North West Delhi
    status: "available",
  },
  {
    driverId: "driver_010",
    driverName: "Meena Joshi",
    vehicleType: "auto",
    vehicleNumber: "DL10ST9012",
    rating: 4.7,
    location: { latitude: 28.6405, longitude: 77.2197 }, // Old Delhi, Chandni Chowk
    status: "available",
  },
  {
    driverId: "driver_011",
    driverName: "Vinod Bansal",
    vehicleType: "car",
    vehicleNumber: "DL11UV3456",
    rating: 4.5,
    location: { latitude: 28.6507, longitude: 77.2334 }, // Kashmere Gate, North Delhi
    status: "available",
  },
  {
    driverId: "driver_012",
    driverName: "Pooja Sethi",
    vehicleType: "bike",
    vehicleNumber: "DL12WX7890",
    rating: 4.9,
    location: { latitude: 28.6304, longitude: 77.2187 }, // Rajendra Place, Central Delhi
    status: "available",
  },
  {
    driverId: "driver_013",
    driverName: "Anil Kapoor",
    vehicleType: "car",
    vehicleNumber: "DL13YZ1234",
    rating: 4.3,
    location: { latitude: 28.6139, longitude: 77.209 }, // Connaught Place, Central Delhi
    status: "available",
  },
  {
    driverId: "driver_014",
    driverName: "Sonia Goel",
    vehicleType: "auto",
    vehicleNumber: "DL14AB5678",
    rating: 4.6,
    location: { latitude: 28.6083, longitude: 77.2442 }, // Nizamuddin, South East Delhi
    status: "available",
  },
  {
    driverId: "driver_015",
    driverName: "Manoj Nair",
    vehicleType: "bike",
    vehicleNumber: "DL15CD9012",
    rating: 4.2,
    location: { latitude: 28.6596, longitude: 77.2311 }, // Model Town, North Delhi
    status: "available",
  },
];

// Function to generate random movement (kept from your code)
function generateRandomMovement(baseLocation, maxDistanceKm = 0.5) {
  const earthRadius = 6371; // km
  const maxDistance = maxDistanceKm / earthRadius;

  const randomDistance = Math.random() * maxDistance;
  const randomBearing = Math.random() * 2 * Math.PI;

  const lat1 = (baseLocation.latitude * Math.PI) / 180;
  const lon1 = (baseLocation.longitude * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(randomDistance) +
      Math.cos(lat1) * Math.sin(randomDistance) * Math.cos(randomBearing)
  );

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(randomBearing) * Math.sin(randomDistance) * Math.cos(lat1),
      Math.cos(randomDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

module.exports = { mockDrivers, generateRandomMovement };
