// Mock user data for testing (ALL inside Delhi city only)
const mockUsers = [
  {
    userId: "user_001",
    userName: "Ayush Sharma",
    location: { latitude: 28.6129, longitude: 77.2295 }, // Connaught Place, Central Delhi
    destination: { latitude: 28.6562, longitude: 77.241 }, // Red Fort, Old Delhi
    vehicleType: "car",
    pickupAddress: "Janpath, Connaught Place",
    dropoffAddress: "Red Fort, Chandni Chowk",
  },
  {
    userId: "user_002",
    userName: "Neha Gupta",
    location: { latitude: 28.6328, longitude: 77.2205 }, // Karol Bagh, Delhi
    destination: { latitude: 28.6139, longitude: 77.209 }, // Connaught Place, Central Delhi
    vehicleType: "bike",
    pickupAddress: "Karol Bagh, Delhi",
    dropoffAddress: "Connaught Place, Delhi",
  },
  {
    userId: "user_003",
    userName: "Rohit Kumar",
    location: { latitude: 28.5733, longitude: 77.2425 }, // Lajpat Nagar, South Delhi
    destination: { latitude: 28.5672, longitude: 77.21 }, // Hauz Khas, South Delhi
    vehicleType: "auto",
    pickupAddress: "Lajpat Nagar, Delhi",
    dropoffAddress: "Hauz Khas, Delhi",
  },
  {
    userId: "user_004",
    userName: "Priya Singh",
    location: { latitude: 28.7041, longitude: 77.1025 }, // Rohini, North West Delhi
    destination: { latitude: 28.6507, longitude: 77.2334 }, // Kashmere Gate, North Delhi
    vehicleType: "car",
    pickupAddress: "Rohini, Delhi",
    dropoffAddress: "Kashmere Gate, Delhi",
  },
  {
    userId: "user_005",
    userName: "Vikram Mehra",
    location: { latitude: 28.5245, longitude: 77.1855 }, // South Extension, South Delhi
    destination: { latitude: 28.6619, longitude: 77.2274 }, // Civil Lines, North Delhi
    vehicleType: "car",
    pickupAddress: "South Extension, Delhi",
    dropoffAddress: "Civil Lines, Delhi",
  },
  {
    userId: "user_006",
    userName: "Simran Kaur",
    location: { latitude: 28.6791, longitude: 77.1025 }, // Pitampura, North West Delhi
    destination: { latitude: 28.687, longitude: 77.2946 }, // Shahdara, East Delhi
    vehicleType: "auto",
    pickupAddress: "Pitampura, Delhi",
    dropoffAddress: "Shahdara, Delhi",
  },
  {
    userId: "user_007",
    userName: "Amit Verma",
    location: { latitude: 28.6083, longitude: 77.2442 }, // Nizamuddin, South East Delhi
    destination: { latitude: 28.6139, longitude: 77.209 }, // Connaught Place, Central Delhi
    vehicleType: "bike",
    pickupAddress: "Nizamuddin, Delhi",
    dropoffAddress: "Connaught Place, Delhi",
  },
  {
    userId: "user_008",
    userName: "Anjali Rao",
    location: { latitude: 28.6507, longitude: 77.2334 }, // Kashmere Gate, North Delhi
    destination: { latitude: 28.5672, longitude: 77.21 }, // Hauz Khas, South Delhi
    vehicleType: "car",
    pickupAddress: "Kashmere Gate, Delhi",
    dropoffAddress: "Hauz Khas, Delhi",
  },
  {
    userId: "user_009",
    userName: "Saurabh Jain",
    location: { latitude: 28.6619, longitude: 77.2274 }, // Civil Lines, North Delhi
    destination: { latitude: 28.5733, longitude: 77.2425 }, // Lajpat Nagar, South Delhi
    vehicleType: "bike",
    pickupAddress: "Civil Lines, Delhi",
    dropoffAddress: "Lajpat Nagar, Delhi",
  },
  {
    userId: "user_010",
    userName: "Megha Choudhary",
    location: { latitude: 28.6304, longitude: 77.2187 }, // Rajendra Place, Central Delhi
    destination: { latitude: 28.6139, longitude: 77.209 }, // Connaught Place, Central Delhi
    vehicleType: "auto",
    pickupAddress: "Rajendra Place, Delhi",
    dropoffAddress: "Connaught Place, Delhi",
  },
];

module.exports = { mockUsers };
