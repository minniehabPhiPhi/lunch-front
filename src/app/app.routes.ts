import { Routes } from '@angular/router';
import { Customer } from './pages/customer/customer';
import { Order } from './pages/order/order';
import { Route } from './pages/route/route';
import { Rider } from './pages/rider/rider';

export const routes: Routes = [
  { path: '', redirectTo: 'customer', pathMatch: 'full' },
  { path: 'customer', component: Customer },
  { path: 'order', component: Order },
  { path: 'route', component: Route },
  { path: 'rider', component: Rider },
];