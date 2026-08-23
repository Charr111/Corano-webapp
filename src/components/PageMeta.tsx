import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const routeMeta: Record<string, { title: string, desc: string }> = {
  '/': {
    title: 'Corano - It Feels Like Home...Made',
    desc: 'Experience the true taste of charcoal grilling. At Corano, every single bite feels like home...made with passion, fire, and flavor.',
  },
  '/home': {
    title: 'Corano - Home',
    desc: 'Welcome to Corano. Experience the true taste of charcoal grilling with passion, fire, and flavor.',
  },
  '/menu': {
    title: 'Corano - Our Menu',
    desc: 'Explore our delicious selection of Sandwiches, Subs, Sajj, Mashewe (Grills), Salads, and Hot Mezza. Freshly prepared for you.',
  },
  '/visit': {
    title: 'Corano - Visit Us',
    desc: 'Find our location, opening hours, and contact details. We can\'t wait to welcome you to Corano.',
  },
  '/reviews': {
    title: 'Corano - Customer Reviews',
    desc: 'Read what our amazing customers have to say about their Corano experience, or leave a review of your own!',
  }
};

const PageMeta = () => {
  const location = useLocation();

  useEffect(() => {
    const meta = routeMeta[location.pathname] || routeMeta['/'];
    
    // Update document title (browser tab)
    document.title = meta.title;

    // Update meta description
    let descTag = document.querySelector('meta[name="description"]');
    if (descTag) {
      descTag.setAttribute('content', meta.desc);
    }

    // Update Open Graph tags for bots that execute JS (like Googlebot)
    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', meta.title);

    let ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute('content', meta.desc);

    let twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.setAttribute('content', meta.title);

    let twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) twitterDesc.setAttribute('content', meta.desc);

  }, [location]);

  return null;
};

export default PageMeta;
