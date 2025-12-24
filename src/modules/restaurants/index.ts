// src/modules/restaurants/index.ts

// Controllers & Services
export * from './restaurants.controller';
export * from './restaurants.service';
export * from './restaurants.module';

// DTOs existants
export { CreateRestaurantDto } from './dto/create-restaurant.dto';
export { UpdateRestaurantDto } from './dto/update-restaurant.dto';
export { LinkReelToRestaurantDto } from './dto/link-reel.dto';
export { AddReviewDto } from './dto/add-review.dto';
export { AddDishDto } from './dto/add-dish.dto';
export { RestaurantChatbotDto } from './dto/restaurant-chatbot.dto';
